// Pure helpers of the two-way chat: message lists merged by their server
// order (seq), messages still on their way (kept by their client id until
// the server's copy arrives), and the composer's limits. No React, no fetch:
// unit-tested in chat.test.ts.

/** The server refuses longer messages (after trimming). */
export const MAX_CHAT_BODY = 2000;

export interface SeqMessage {
  id: string;
  seq: number;
  clientMessageId: string;
  mine: boolean;
}

/** A message typed here that the server has not confirmed yet. */
export interface PendingMessage {
  clientMessageId: string;
  body: string;
  /** sending: on its way; failed: refused or lost, may be retried with the same id. */
  status: "sending" | "failed";
  error?: string | null;
  createdAt: string;
}

/**
 * Both lists merged, one copy per message (the later copy wins), in the
 * server's order. Pages fetched out of order (an older page, a catch-up
 * after a reconnect, a send's own answer) all land in the right place.
 */
export function mergeMessages<T extends SeqMessage>(current: readonly T[], incoming: readonly T[]): T[] {
  if (incoming.length === 0) return current as T[];
  const bySeq = new Map<number, T>();
  for (const m of current) bySeq.set(m.seq, m);
  for (const m of incoming) bySeq.set(m.seq, m);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

/** The highest seq in the list (0 when empty): the cursor for "what came after". */
export function lastSeq(list: readonly { seq: number }[]): number {
  let max = 0;
  for (const m of list) if (m.seq > max) max = m.seq;
  return max;
}

/** The lowest seq in the list (null when empty): the cursor for "older". */
export function firstSeq(list: readonly { seq: number }[]): number | null {
  let min: number | null = null;
  for (const m of list) if (min === null || m.seq < min) min = m.seq;
  return min;
}

/**
 * Adds a message on its way, or updates the one with the same client id
 * (a retry or a second click of the same message): never two copies.
 */
export function upsertPending(list: readonly PendingMessage[], p: PendingMessage): PendingMessage[] {
  const i = list.findIndex((x) => x.clientMessageId === p.clientMessageId);
  if (i < 0) return [...list, p];
  const next = list.slice();
  next[i] = { ...list[i], ...p, createdAt: list[i].createdAt };
  return next;
}

export function removePending(list: readonly PendingMessage[], clientMessageId: string): PendingMessage[] {
  return list.some((p) => p.clientMessageId === clientMessageId) ? list.filter((p) => p.clientMessageId !== clientMessageId) : (list as PendingMessage[]);
}

export function failPending(list: readonly PendingMessage[], clientMessageId: string, error: string | null): PendingMessage[] {
  return list.map((p) => (p.clientMessageId === clientMessageId ? { ...p, status: "failed" as const, error } : p));
}

/**
 * Messages on their way whose server copy is already in the list (it came
 * back through the stream before the send's own answer) are done.
 */
export function dropConfirmed(pending: readonly PendingMessage[], messages: readonly SeqMessage[]): PendingMessage[] {
  if (pending.length === 0) return pending as PendingMessage[];
  const mine = new Set(messages.filter((m) => m.mine).map((m) => m.clientMessageId));
  const left = pending.filter((p) => !mine.has(p.clientMessageId));
  return left.length === pending.length ? (pending as PendingMessage[]) : left;
}

/** What the composer may send: the trimmed text, or why not. */
export function checkBody(text: string): { ok: true; body: string } | { ok: false; reason: "empty" | "tooLong" } {
  const body = text.replace(/\r\n/g, "\n").trim();
  if (!body) return { ok: false, reason: "empty" };
  if (body.length > MAX_CHAT_BODY) return { ok: false, reason: "tooLong" };
  return { ok: true, body };
}

/**
 * A new message's client id: made once per message and sent again on every
 * retry, so the server stores it once. The server accepts 8-64 characters
 * of [A-Za-z0-9_-].
 */
export function newClientMessageId(cryptoImpl: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } | undefined = globalThis.crypto): string {
  if (cryptoImpl?.randomUUID) {
    try {
      return cryptoImpl.randomUUID();
    } catch {
      // not a secure context: fall through
    }
  }
  const bytes = new Uint8Array(16);
  if (cryptoImpl?.getRandomValues) cryptoImpl.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The total of the unread counts of a conversation list. */
export function unreadTotal(list: readonly { unread: number }[]): number {
  return list.reduce((n, c) => n + (c.unread > 0 ? c.unread : 0), 0);
}

/** What a message says about its sender (see ChatMessage in lib/api.ts). */
export interface SenderParts {
  senderName: string;
  senderRole?: "staff" | "student" | "parent";
  senderPerson?: string | null;
  senderAbout?: string | null;
}

/**
 * The sender's name in the reader's language. `parentOf` and `parentNamed`
 * are that language's templates ({child}, {name}); messages from an older
 * server without the parts fall back to the stored label.
 */
export function senderLabel(m: SenderParts, templates: { parentOf: string; parentNamed: string }): string {
  if (m.senderRole !== "parent" || !m.senderAbout) return m.senderPerson || m.senderName;
  const child = m.senderAbout;
  return m.senderPerson
    ? templates.parentNamed.replace("{name}", m.senderPerson).replace("{child}", child)
    : templates.parentOf.replace("{child}", child);
}
