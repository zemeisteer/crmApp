"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatClient, ChatConversation } from "@/lib/api";
import type { ChatStreamState, ChatStreamStop } from "@/lib/chat-stream";
import { unreadTotal } from "@/lib/chat";
import { useLanguage } from "@/lib/i18n-context";
import ChatThread, { type LiveSignal } from "./ChatThread";
import NewConversation from "./NewConversation";
import { CHAT_ACCENT as ACCENT, UnreadBadge, conversationTitle, kindLabel, messageTime } from "./shared";

// Wide screens: the list and the open conversation side by side. Phones:
// two screens - the list, or the conversation with a back button.
const CSS = `
.chat-layout{display:flex;flex:1;min-height:0;height:100%;background:#fff;border:1px solid #EAE8E2;border-radius:14px;overflow:hidden;min-width:0}
.chat-list{width:320px;flex:0 0 320px;border-right:1px solid #EAE8E2;display:flex;flex-direction:column;min-height:0;min-width:0}
.chat-pane{flex:1;display:flex;flex-direction:column;min-height:0;min-width:0}
.chat-back{display:none}
.chat-item{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;border:none;background:transparent;padding:11px 14px;cursor:pointer;font-family:inherit;color:#181A1F;border-bottom:1px solid #F2F1EC;min-width:0}
.chat-item:hover{background:#FAFAF8}
.chat-item[aria-current="true"]{background:#EEF0FF}
@media (max-width:768px){
  .chat-list{width:100%;flex:1 1 auto;border-right:none}
  .chat-layout[data-view="thread"] .chat-list{display:none}
  .chat-layout[data-view="list"] .chat-pane{display:none}
  .chat-back{display:inline-flex}
}
`;

/**
 * The conversations of one signed-in person (staff, or a student's cabinet):
 * the list with unread counts, starting a new one, and the open thread.
 * One live stream feeds both: a `message` event refreshes the list and lets
 * the open thread fetch what came after; `ready` (also after a reconnect)
 * catches everything up.
 */
export default function ChatView({
  client,
  selectedId,
  onSelect,
  onUnread,
  teacher = false,
}: {
  client: ChatClient;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onUnread?: (total: number) => void;
  teacher?: boolean;
}) {
  const { t, lang } = useLanguage();
  const [list, setList] = useState<ChatConversation[] | null>(null);
  const [listError, setListError] = useState(false);
  const [live, setLive] = useState<LiveSignal | null>(null);
  const [conn, setConn] = useState<ChatStreamState>("connecting");
  const [stopped, setStopped] = useState<ChatStreamStop | null>(null);
  const [picking, setPicking] = useState(false);
  // How far this page has read each conversation: a list fetched before the
  // read was stored must not bring the unread count back.
  const readUpTo = useRef(new Map<string, number>());
  const signals = useRef(0);
  const listTimer = useRef<number | null>(null);
  const alive = useRef(true);

  const withReads = useCallback((rows: ChatConversation[]) => rows.map((c) => {
    const r = readUpTo.current.get(c.id);
    return r !== undefined && c.unread > 0 && r >= (c.lastMessage?.seq ?? 0) ? { ...c, unread: 0, lastReadSeq: Math.max(c.lastReadSeq, r) } : c;
  }), []);

  const loadList = useCallback(() => {
    client
      .list()
      .then((rows) => {
        if (!alive.current) return;
        setList(withReads(rows));
        setListError(false);
      })
      .catch(() => alive.current && setListError(true));
  }, [client, withReads]);

  // A burst of messages is one list request.
  const scheduleList = useCallback(() => {
    if (listTimer.current !== null) window.clearTimeout(listTimer.current);
    listTimer.current = window.setTimeout(() => {
      listTimer.current = null;
      loadList();
    }, 120);
  }, [loadList]);

  useEffect(() => {
    alive.current = true;
    loadList();
    const stream = client.stream({
      onEvent: (e) => {
        if (e.event === "ready") {
          // Connected (again): whatever came while not connected is fetched now.
          scheduleList();
          setLive({ conversationId: "*", seq: 0, n: ++signals.current });
          return;
        }
        if (e.event !== "message") return;
        try {
          const d = JSON.parse(e.data) as { conversationId?: unknown; seq?: unknown };
          if (typeof d.conversationId !== "string") return;
          setLive({ conversationId: d.conversationId, seq: Number(d.seq) || 0, n: ++signals.current });
          scheduleList();
        } catch {
          // not ours
        }
      },
      onState: setConn,
      onStop: setStopped,
    });
    return () => {
      alive.current = false;
      stream.close();
      if (listTimer.current !== null) window.clearTimeout(listTimer.current);
    };
  }, [client, loadList, scheduleList]);

  useEffect(() => {
    if (list) onUnread?.(unreadTotal(list));
  }, [list, onUnread]);

  const onRead = useCallback((id: string, seq: number) => {
    readUpTo.current.set(id, Math.max(readUpTo.current.get(id) ?? 0, seq));
    setList((prev) => prev && prev.map((c) => (c.id === id && c.unread > 0 && seq >= (c.lastMessage?.seq ?? 0) ? { ...c, unread: 0, lastReadSeq: seq } : c)));
  }, []);

  const listRef = useRef<ChatConversation[] | null>(null);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  const onFound = useCallback((id: string) => {
    const known = listRef.current;
    if (known && !known.some((c) => c.id === id)) scheduleList();
  }, [scheduleList]);

  function opened(c: ChatConversation) {
    setList((prev) => (prev?.some((x) => x.id === c.id) ? prev : [c, ...(prev ?? [])]));
    setPicking(false);
    onSelect(c.id);
  }

  const selected = list?.find((c) => c.id === selectedId);

  return (
    <div className="chat-layout" data-view={selectedId ? "thread" : "list"} data-chat-live={conn}>
      <style>{CSS}</style>
      <div className="chat-list">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "12px 14px", borderBottom: "1px solid #EAE8E2" }}>
          <h2 style={{ fontSize: 15, fontWeight: 800 }}>{t("chat.conversations")}</h2>
          <button type="button" className="btn" onClick={() => setPicking((v) => !v)} aria-expanded={picking} style={{ background: ACCENT, color: "#fff", fontWeight: 700, fontSize: 12.5, padding: "7px 11px", borderRadius: 9, whiteSpace: "nowrap" }}>
            {t("chat.new")}
          </button>
        </div>
        {(stopped || conn === "waiting") && (
          <div role="status" style={{ padding: "8px 14px", fontSize: 12.5, background: stopped ? "#FDEBEC" : "#FFF7E6", color: stopped ? "#B23A47" : "#92400E", borderBottom: "1px solid #EAE8E2" }}>
            {stopped ? t("chat.liveStopped") : t("chat.reconnecting")}
          </div>
        )}
        {picking && <NewConversation client={client} teacher={teacher} onOpened={opened} onClose={() => setPicking(false)} />}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} aria-busy={list === null}>
          {listError && !list ? (
            <div role="alert" style={{ padding: 16, fontSize: 13, color: "#B23A47", display: "grid", gap: 8, justifyItems: "start" }}>
              {t("chat.loadError")}
              <button type="button" className="btn" onClick={loadList} style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", fontWeight: 700, fontSize: 12.5, padding: "6px 12px", borderRadius: 8 }}>{t("chat.retryLoad")}</button>
            </div>
          ) : list === null ? (
            <div role="status" style={{ padding: 16, fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
          ) : list.length === 0 ? (
            <div style={{ padding: "24px 16px", fontSize: 13.5, color: "#686B75", lineHeight: 1.5 }}>{t("chat.noConversations")}</div>
          ) : (
            <ul aria-label={t("chat.conversations")} style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {list.map((c) => {
                const title = conversationTitle(c, client.side, t);
                return (
                  <li key={c.id}>
                    <button type="button" className="chat-item" aria-current={c.id === selectedId ? "true" : undefined} onClick={() => onSelect(c.id)}>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: c.unread > 0 ? 800 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{title}</span>
                          {c.lastMessage && <span style={{ fontSize: 11.5, color: "#686B75", flexShrink: 0 }}>{messageTime(c.lastMessage.createdAt, lang)}</span>}
                        </span>
                        <span style={{ display: "block", fontSize: 11.5, color: "#686B75", marginTop: 1 }}>{kindLabel(c.kind, client.side, t)}</span>
                        <span style={{ display: "block", fontSize: 13, color: c.unread > 0 ? "#181A1F" : "#4A4E58", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.lastMessage ? c.lastMessage.body : t("chat.noMessagesYet")}
                        </span>
                      </span>
                      <UnreadBadge count={c.unread} label={t("chat.unreadN")} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      <div className="chat-pane">
        {selectedId ? (
          <ChatThread
            key={selectedId}
            client={client}
            conversationId={selectedId}
            conversation={selected}
            live={live}
            onRead={onRead}
            onSent={scheduleList}
            onBack={() => onSelect(null)}
            onFound={onFound}
          />
        ) : (
          <div style={{ flex: 1, display: "grid", placeContent: "center", textAlign: "center", padding: 24, color: "#686B75", fontSize: 13.5 }}>{t("chat.pickConversation")}</div>
        )}
      </div>
    </div>
  );
}
