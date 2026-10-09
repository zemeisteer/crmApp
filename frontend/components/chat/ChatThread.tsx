"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ApiError, type ChatClient, type ChatConversation, type ChatMessage } from "@/lib/api";
import {
  MAX_CHAT_BODY, checkBody, dropConfirmed, failPending, firstSeq, lastSeq, mergeMessages, newClientMessageId, removePending, senderLabel, upsertPending, type PendingMessage,
} from "@/lib/chat";
import { useLanguage } from "@/lib/i18n-context";
import { CHAT_ACCENT as ACCENT, conversationTitle, kindLabel, messageTime, srOnly } from "./shared";

const PAGE = 50;

/** A new message (or a reconnect) in this conversation: fetch what came after. */
export interface LiveSignal {
  /** "*" after a reconnect: every open thread catches up. */
  conversationId: string;
  seq: number;
  n: number;
}

/**
 * One conversation: its history (older pages on request), new messages as
 * the stream announces them, and the composer. A message typed here shows
 * at once as "sending"; its client id is made once and sent again on a
 * retry, so the server keeps one copy whatever happens to the answer.
 */
export default function ChatThread({
  client,
  conversationId,
  conversation,
  live,
  onRead,
  onSent,
  onBack,
  onFound,
}: {
  client: ChatClient;
  conversationId: string;
  conversation: ChatConversation | undefined;
  live: LiveSignal | null;
  onRead: (conversationId: string, seq: number) => void;
  onSent: (conversationId: string) => void;
  onBack: () => void;
  /** Loaded although it was not in the list (a link, a list not yet fresh). */
  onFound: (conversationId: string) => void;
}) {
  const { t, lang } = useLanguage();
  const uid = useId();
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "notFound" | "error">("loading");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [text, setText] = useState("");
  // The text and its client id, read synchronously: a second click before
  // the page re-renders finds the composer already empty.
  const textRef = useRef("");
  const draftIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const keepOffset = useRef<number | null>(null);
  const loadedRef = useRef(false);
  const liveWaiting = useRef(false);
  const busy = useRef(false);
  const again = useRef(false);
  const readSent = useRef(0);
  const aliveRef = useRef(true);

  const commit = useCallback((incoming: ChatMessage[]) => {
    const next = mergeMessages(messagesRef.current, incoming);
    if (next === messagesRef.current) return;
    messagesRef.current = next;
    setMessagesState(next);
    // Server copies of messages sent from here replace the "sending" ones.
    setPending((p) => dropConfirmed(p, next));
  }, []);

  // ---- loading ----------------------------------------------------------

  const catchUp = useCallback(async () => {
    if (!loadedRef.current) {
      liveWaiting.current = true;
      return;
    }
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    try {
      do {
        again.current = false;
        for (;;) {
          const page = await client.messages(conversationId, { after: lastSeq(messagesRef.current), limit: 100 });
          if (!aliveRef.current) return;
          commit(page.messages);
          if (!page.hasMore || page.messages.length === 0) break;
        }
      } while (again.current && aliveRef.current);
    } catch {
      // the next event or reconnect catches up
    } finally {
      busy.current = false;
    }
  }, [client, conversationId, commit]);

  useEffect(() => {
    aliveRef.current = true;
    // The thread is mounted per conversation; only a retry after a failed
    // load runs this again (its button shows "loading" itself).
    loadedRef.current = false;
    stickToBottom.current = true;
    client
      .messages(conversationId, { limit: PAGE })
      .then((page) => {
        if (!aliveRef.current) return;
        commit(page.messages);
        setHasMore(page.hasMore);
        setStatus("ready");
        loadedRef.current = true;
        onFound(conversationId);
        if (liveWaiting.current) {
          liveWaiting.current = false;
          void catchUp();
        }
      })
      .catch((err) => {
        if (!aliveRef.current) return;
        // Not found and not allowed look the same (the server says 404 for both).
        setStatus(err instanceof ApiError && (err.status === 404 || err.status === 400) ? "notFound" : "error");
      });
    return () => {
      aliveRef.current = false;
    };
    // onFound is a notification only; a new function must not reload the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, conversationId, reloadKey, commit, catchUp]);

  useEffect(() => {
    if (!live) return;
    if (live.conversationId === conversationId || live.conversationId === "*") void catchUp();
  }, [live, conversationId, catchUp]);

  async function loadOlder() {
    const before = firstSeq(messagesRef.current);
    if (before === null || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(false);
    try {
      const page = await client.messages(conversationId, { before, limit: PAGE });
      if (!aliveRef.current) return;
      const el = scrollRef.current;
      keepOffset.current = el ? el.scrollHeight - el.scrollTop : null;
      stickToBottom.current = false;
      commit(page.messages);
      setHasMore(page.hasMore);
    } catch {
      if (aliveRef.current) setOlderError(true);
    } finally {
      if (aliveRef.current) setLoadingOlder(false);
    }
  }

  // ---- reading ----------------------------------------------------------

  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const list = messagesRef.current;
    const top = lastSeq(list);
    if (top === 0 || top <= readSent.current) return;
    // Only others' messages make anything unread (one's own are read already).
    const since = Math.max(readSent.current, conversation?.lastReadSeq ?? 0);
    const unseen = list.some((m) => !m.mine && m.seq > since);
    readSent.current = top;
    if (!unseen) {
      onRead(conversationId, top);
      return;
    }
    client
      .read(conversationId, top)
      .then(() => {
        if (aliveRef.current) onRead(conversationId, top);
      })
      .catch(() => {
        readSent.current = 0;
      });
  }, [client, conversationId, conversation, onRead]);

  useEffect(() => {
    if (status === "ready") markRead();
  }, [messages, status, markRead]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && loadedRef.current) markRead();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  // ---- scrolling ---------------------------------------------------------

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (keepOffset.current !== null) {
      el.scrollTop = el.scrollHeight - keepOffset.current;
      keepOffset.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, pending, status]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }

  // ---- sending ------------------------------------------------------------

  function submit(p: { clientMessageId: string; body: string }) {
    setPending((list) => upsertPending(list, { ...p, status: "sending", error: null, createdAt: new Date().toISOString() }));
    stickToBottom.current = true;
    client
      .send(conversationId, p.body, p.clientMessageId)
      .then((r) => {
        if (!aliveRef.current) return;
        commit([r.message]);
        setPending((list) => removePending(list, p.clientMessageId));
        onSent(conversationId);
      })
      .catch((err) => {
        if (!aliveRef.current) return;
        const msg = err instanceof ApiError ? (err.status === 429 ? t("chat.tooFast") : err.status >= 500 ? t("chat.sendFailed") : err.message) : t("chat.sendFailed");
        setPending((list) => failPending(list, p.clientMessageId, msg));
      });
  }

  function send() {
    const checked = checkBody(textRef.current);
    if (!checked.ok) return;
    const clientMessageId = draftIdRef.current ?? newClientMessageId();
    // The composer is emptied before anything else: a second click sends nothing.
    textRef.current = "";
    draftIdRef.current = null;
    setText("");
    submit({ clientMessageId, body: checked.body });
  }

  function onChange(v: string) {
    textRef.current = v;
    setText(v);
    // One client id per message, made when it is started.
    if (!draftIdRef.current && v.trim()) draftIdRef.current = newClientMessageId();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line; an IME composing text keeps Enter.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // ---- view ----------------------------------------------------------------

  const title = conversation ? conversationTitle(conversation, client.side, t) : t("chat.conversation");
  const subtitle = conversation ? kindLabel(conversation.kind, client.side, t) : "";
  const checked = checkBody(text);
  const length = text.replace(/\r\n/g, "\n").trim().length;
  const tooLong = length > MAX_CHAT_BODY;
  const canWrite = conversation ? conversation.canWrite : status === "ready";
  const visiblePending = dropConfirmed(pending, messages);

  return (
    <section aria-labelledby={`${uid}-title`} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #EAE8E2", minWidth: 0 }}>
        <button type="button" className="chat-back btn" onClick={onBack} aria-label={t("chat.back")} style={{ background: "#F2F1EC", color: "#181A1F", borderRadius: 9, width: 34, height: 34, alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
          <span aria-hidden="true">←</span>
        </button>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 id={`${uid}-title`} style={{ fontSize: 15.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{status === "notFound" ? t("chat.notFoundTitle") : title}</h2>
          {subtitle && status !== "notFound" && <div style={{ fontSize: 12, color: "#686B75", marginTop: 1 }}>{subtitle}</div>}
        </div>
      </header>

      {status === "notFound" ? (
        <div role="alert" style={{ flex: 1, display: "grid", placeContent: "center", justifyItems: "center", gap: 8, padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{t("chat.notFoundTitle")}</div>
          <div style={{ fontSize: 13.5, color: "#686B75", maxWidth: 360 }}>{t("chat.notFoundText")}</div>
          <button type="button" className="btn" onClick={onBack} style={{ marginTop: 6, background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 13.5, padding: "9px 16px", borderRadius: 10 }}>{t("chat.backToList")}</button>
        </div>
      ) : status === "error" ? (
        <div role="alert" style={{ flex: 1, display: "grid", placeContent: "center", justifyItems: "center", gap: 10, padding: 24, textAlign: "center", color: "#B23A47", fontSize: 13.5, fontWeight: 600 }}>
          {t("chat.loadError")}
          <button type="button" className="btn" onClick={() => {
              setStatus("loading");
              setReloadKey((k) => k + 1);
            }} style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", fontWeight: 700, fontSize: 13, padding: "7px 14px", borderRadius: 9 }}>{t("chat.retryLoad")}</button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "12px 16px", background: "#FAFAF8" }}>
            {status === "loading" ? (
              <div role="status" style={{ color: "#686B75", fontSize: 13, textAlign: "center", padding: 20 }}>{t("common.loading")}</div>
            ) : (
              <>
                {hasMore && (
                  <div style={{ textAlign: "center", marginBottom: 10 }}>
                    <button type="button" className="btn" onClick={loadOlder} disabled={loadingOlder} style={{ background: "#fff", color: ACCENT, border: "1px solid #C7D2FE", fontWeight: 700, fontSize: 12.5, padding: "6px 12px", borderRadius: 100 }}>
                      {loadingOlder ? t("common.loading") : t("chat.loadOlder")}
                    </button>
                    {olderError && <div role="alert" style={{ color: "#B23A47", fontSize: 12.5, marginTop: 6 }}>{t("chat.loadError")}</div>}
                  </div>
                )}
                {messages.length === 0 && visiblePending.length === 0 && (
                  <div style={{ color: "#686B75", fontSize: 13.5, textAlign: "center", padding: "28px 12px" }}>{t("chat.emptyThread")}</div>
                )}
                {/* New messages are announced politely; older pages and one's own sends are not repeated aloud. */}
                <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t("chat.messagesLabel")}>
                <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                  {messages.map((m) => (
                    <Bubble key={m.id} mine={m.mine} name={m.mine ? t("chat.you") : senderLabel(m, { parentOf: t("chat.parentOf"), parentNamed: t("chat.parentNamed") })} time={messageTime(m.createdAt, lang)} body={m.body} />
                  ))}
                  {visiblePending.map((p) => (
                    <Bubble
                      key={p.clientMessageId}
                      mine
                      name={t("chat.you")}
                      body={p.body}
                      time={p.status === "sending" ? t("chat.sending") : ""}
                      failed={p.status === "failed" ? { error: p.error ?? t("chat.sendFailed"), retry: () => submit({ clientMessageId: p.clientMessageId, body: p.body }), retryLabel: t("chat.retry") } : undefined}
                    />
                  ))}
                </ol>
                </div>
              </>
            )}
          </div>

          {status === "ready" && !canWrite ? (
            <div role="note" style={{ padding: "12px 16px", borderTop: "1px solid #EAE8E2", fontSize: 13, color: "#4A4E58", background: "#fff" }}>
              {conversation?.oversight ? t("chat.readOnlyOversight") : t("chat.readOnly")}
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              style={{ borderTop: "1px solid #EAE8E2", padding: "10px 12px", background: "#fff", display: "flex", gap: 8, alignItems: "flex-end" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <label htmlFor={`${uid}-text`} style={srOnly}>{t("chat.composerLabel")}</label>
                <textarea
                  id={`${uid}-text`}
                  value={text}
                  onChange={(e) => onChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={2}
                  disabled={status !== "ready"}
                  placeholder={t("chat.placeholder")}
                  aria-describedby={`${uid}-count ${uid}-hint`}
                  aria-invalid={tooLong || undefined}
                  className="field-input"
                  style={{ resize: "none", padding: "9px 12px", fontSize: 14, lineHeight: 1.45, maxHeight: 160, display: "block" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, fontSize: 11.5, color: "#686B75" }}>
                  <span id={`${uid}-hint`} className="hide-sm">{t("chat.enterHint")}</span>
                  <span id={`${uid}-count`} style={{ marginLeft: "auto", color: tooLong ? "#B23A47" : "#686B75", fontWeight: tooLong ? 700 : 500 }}>
                    {length}/{MAX_CHAT_BODY}
                    {tooLong && <span style={srOnly}> {t("chat.tooLong")}</span>}
                  </span>
                </div>
              </div>
              <button type="submit" className="btn" disabled={!checked.ok || status !== "ready"} style={{ background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 14, padding: "10px 16px", borderRadius: 10, marginBottom: 20, flexShrink: 0 }}>
                {t("chat.send")}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}

function Bubble({ mine, name, time, body, failed }: { mine: boolean; name: string; time: string; body: string; failed?: { error: string; retry: () => void; retryLabel: string } }) {
  return (
    <li style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start", minWidth: 0 }}>
      <div
        style={{
          maxWidth: "min(78%, 560px)", minWidth: 0, padding: "8px 12px", borderRadius: 14,
          borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4,
          background: failed ? "#FDEBEC" : mine ? ACCENT : "#fff",
          color: failed ? "#7F1D1D" : mine ? "#fff" : "#181A1F",
          border: mine && !failed ? "none" : `1px solid ${failed ? "#F6CDD1" : "#EAE8E2"}`,
        }}
      >
        <div style={{ fontSize: 11.5, fontWeight: 700, opacity: mine && !failed ? 0.9 : 1, color: mine ? undefined : "#4A4E58", marginBottom: 2, overflowWrap: "anywhere" }}>{name}</div>
        <div style={{ fontSize: 14, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{body}</div>
        {time && <div style={{ fontSize: 11, marginTop: 3, textAlign: "right", color: mine && !failed ? "#E0E7FF" : "#686B75" }}>{time}</div>}
      </div>
      {failed && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12, color: "#B23A47", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span>{failed.error}</span>
          <button type="button" className="btn" onClick={failed.retry} style={{ background: "#fff", color: "#B23A47", border: "1px solid #F6CDD1", fontWeight: 700, fontSize: 12, padding: "4px 10px", borderRadius: 8 }}>
            {failed.retryLabel}
          </button>
        </div>
      )}
    </li>
  );
}
