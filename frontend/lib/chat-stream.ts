// The chat's live channel: a server-sent event stream read with fetch() so
// the session token travels in the Authorization header (EventSource cannot
// set headers, and a token in the URL would end up in logs and history).
// The server sends `ready` once connected, `message` {conversationId, seq}
// for each new message the client may read, `revoked` before it closes a
// stream whose session no longer holds, and `: ping` comments as a
// heartbeat. A dropped stream is opened again with growing pauses; a
// revoked or refused one (401 after a refresh attempt, 403) is not.
// No React here: unit-tested in chat-stream.test.ts.

export interface SseEvent {
  /** The `event:` field; "message" when the frame has none. */
  event: string;
  /** The `data:` lines joined with "\n". */
  data: string;
  id?: string;
}

/**
 * Incremental parser of the text/event-stream format: feed it decoded text
 * as it arrives (lines and frames may be split anywhere, also between "\r"
 * and "\n"); it returns the frames completed so far. Comment lines (":")
 * are counted, not returned.
 */
export class SseParser {
  private buf = "";
  private data: string[] = [];
  private event = "";
  private id: string | undefined;
  private lastId: string | undefined;
  private pendingCR = false;
  private started = false;
  comments = 0;

  push(chunk: string): SseEvent[] {
    let s = chunk;
    if (!this.started && s.length > 0) {
      this.started = true;
      if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    }
    // "\r" ended the previous chunk: a "\n" right after it is the same line end.
    if (this.pendingCR && s.startsWith("\n")) s = s.slice(1);
    this.pendingCR = false;
    this.buf += s;
    const out: SseEvent[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c !== "\n" && c !== "\r") continue;
      const line = this.buf.slice(start, i);
      if (c === "\r") {
        if (i + 1 < this.buf.length) {
          if (this.buf[i + 1] === "\n") i++;
        } else {
          this.pendingCR = true;
        }
      }
      this.line(line, out);
      start = i + 1;
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  private line(line: string, out: SseEvent[]) {
    if (line === "") {
      // A blank line ends the frame; a frame without data is not an event.
      if (this.data.length > 0) {
        const ev: SseEvent = { event: this.event || "message", data: this.data.join("\n") };
        if (this.lastId !== undefined) ev.id = this.lastId;
        out.push(ev);
      }
      this.data = [];
      this.event = "";
      return;
    }
    if (line.startsWith(":")) {
      this.comments++;
      return;
    }
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.lastId = this.id = value;
    // "retry" and unknown fields are ignored: the pauses are ours.
  }
}

/** The pause before reconnect attempt `attempt` (0-based): doubling, capped, with jitter (50-100 %). */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 30_000, random: () => number = Math.random): number {
  const raw = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 20));
  return Math.round(raw * (0.5 + random() * 0.5));
}

export type ChatStreamStop = "revoked" | "unauthorized" | "forbidden";
export type ChatStreamState = "connecting" | "open" | "waiting" | "stopped";

export interface ChatStreamOptions {
  url: string;
  /** Read before every attempt: a refreshed token is picked up on reconnect. */
  getToken: () => string | null;
  /** `ready` (also after every reconnect: catch up then) and `message` frames. */
  onEvent: (e: SseEvent) => void;
  /** The server ended it for good: not reconnected. */
  onStop?: (reason: ChatStreamStop) => void;
  onState?: (s: ChatStreamState) => void;
  /** Tried once on a 401 (staff: the refresh token); true connects again at once. */
  refresh?: () => Promise<boolean>;
  fetchImpl?: typeof fetch;
  baseDelayMs?: number;
  maxDelayMs?: number;
  random?: () => number;
  /**
   * Silence (not even a ping) this long means a dead connection that never
   * said so (a proxy, a sleeping laptop): drop it and connect again. The
   * server pings every 25 s. 0 turns it off.
   */
  idleTimeoutMs?: number;
}

export interface ChatStreamHandle {
  /** Stops for good: aborts the open request and any planned reconnect. */
  close(): void;
}

export function connectChatStream(opts: ChatStreamOptions): ChatStreamHandle {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const idleMs = opts.idleTimeoutMs ?? 70_000;
  let stopped = false;
  let attempt = 0;
  let refreshTried = false;
  let ctl: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const setState = (s: ChatStreamState) => {
    try {
      opts.onState?.(s);
    } catch {
      // a listener's error never stops the stream
    }
  };

  function halt() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    ctl?.abort();
    ctl = null;
  }

  function finish(reason: ChatStreamStop) {
    if (stopped) return;
    halt();
    setState("stopped");
    opts.onStop?.(reason);
  }

  function retry() {
    if (stopped) return;
    const delay = backoffDelay(attempt++, opts.baseDelayMs ?? 1000, opts.maxDelayMs ?? 30_000, opts.random);
    setState("waiting");
    timer = setTimeout(() => {
      timer = null;
      void connect();
    }, delay);
  }

  async function connect(): Promise<void> {
    if (stopped) return;
    const token = opts.getToken();
    if (!token) return finish("unauthorized");
    const mine = new AbortController();
    ctl = mine;
    setState("connecting");
    let res: Response;
    try {
      res = await doFetch(opts.url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
        signal: mine.signal,
        cache: "no-store",
      });
    } catch {
      return retry();
    }
    if (stopped || ctl !== mine) {
      void res.body?.cancel().catch(() => undefined);
      return;
    }
    if (res.status === 401) {
      void res.body?.cancel().catch(() => undefined);
      if (!refreshTried && opts.refresh) {
        refreshTried = true;
        const ok = await opts.refresh().catch(() => false);
        if (stopped) return;
        if (ok) return connect();
      }
      return finish("unauthorized");
    }
    if (res.status === 403) {
      void res.body?.cancel().catch(() => undefined);
      return finish("forbidden");
    }
    if (!res.ok || !res.body) {
      void res.body?.cancel().catch(() => undefined);
      return retry();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    let idle: ReturnType<typeof setTimeout> | null = null;
    const arm = () => {
      if (idle) clearTimeout(idle);
      if (idleMs > 0) idle = setTimeout(() => mine.abort(), idleMs);
    };
    arm();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done || stopped) break;
        arm();
        for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
          if (stopped) break;
          if (ev.event === "revoked") {
            finish("revoked");
            break;
          }
          if (ev.event === "ready") {
            // Connected: the next drop starts the pauses from the beginning.
            attempt = 0;
            refreshTried = false;
            setState("open");
          }
          try {
            opts.onEvent(ev);
          } catch {
            // a listener's error never stops the stream
          }
        }
        if (stopped) break;
      }
    } catch {
      // dropped or aborted (closed, or silent too long)
    } finally {
      if (idle) clearTimeout(idle);
      reader.cancel().catch(() => undefined);
    }
    if (!stopped && ctl === mine) retry();
  }

  void connect();
  return {
    close() {
      if (stopped) return;
      halt();
      setState("stopped");
    },
  };
}
