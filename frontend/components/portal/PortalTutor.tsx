"use client";

import { useEffect, useRef, useState } from "react";
import { ApiError, portalApi, type PortalTutorState } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import MarkdownLite from "@/components/MarkdownLite";
import { PORTAL_ACCENT as ACCENT, TabTitle, portalCard as card } from "./PortalTabs";

// The AI tutor in the student's cabinet: the same conversation and daily
// limit as the "🤖 AI ustoz" button in the Telegram bot.

// Formulas: drop LaTeX dollars ($2x$) and show 2 * 6 as 2 × 6 so the
// asterisk is not read as markdown.
const plainMath = (s: string) => s.replace(/\$([^$\n]{1,120})\$/g, "$1").replace(/(\d|\))\s*\*\s*(?=[\d(])/g, "$1 × ");

type Msg = { role: "user" | "assistant"; content: string; pending?: boolean; failed?: boolean };

export default function PortalTutor({ firstName }: { firstName?: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<PortalTutorState | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    portalApi
      .aiState()
      .then((s) => {
        setState(s);
        setMsgs(s.messages.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => setNotice(t("tutor.loadError")));
  }, [t]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs.length, busy]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy || !state) return;
    setBusy(true);
    setNotice(null);
    setText("");
    setMsgs((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);
    try {
      const res = await portalApi.aiAsk(q);
      if (res.status === "ok") {
        setMsgs((m) => [...m.slice(0, -1), { role: "assistant", content: res.reply }]);
        setState((s) => (s ? { ...s, left: res.left } : s));
      } else {
        // Nothing was saved: take the question back out and explain.
        setMsgs((m) => m.slice(0, -2));
        setText(q);
        if (res.status === "limit") {
          setState((s) => (s ? { ...s, left: 0 } : s));
          setNotice(t("tutor.limitReached").replace("{n}", String(res.limit)));
        } else if (res.status === "off") setNotice(t("tutor.off"));
        else if (res.status === "unavailable") setNotice(t("tutor.unavailable"));
        else setNotice(t("tutor.error"));
      }
    } catch (err) {
      setMsgs((m) => m.slice(0, -2));
      setText(q);
      setNotice(err instanceof ApiError && err.status === 429 ? t("tutor.slowDown") : t("tutor.error"));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function reset() {
    if (busy) return;
    try {
      await portalApi.aiReset();
      setMsgs([]);
      setNotice(null);
    } catch {
      setNotice(t("tutor.error"));
    }
  }

  if (!state) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TabTitle title={`🤖 ${t("tutor.title")}`} />
        <div style={{ ...card, color: "#8A8D96", fontSize: 14 }}>{notice ?? t("common.loading")}</div>
      </div>
    );
  }

  if (!state.enabled || !state.available) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <TabTitle title={`🤖 ${t("tutor.title")}`} />
        <div style={{ ...card, textAlign: "center", padding: "36px 20px", color: "#6B6E78", fontSize: 14 }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🤖</div>
          {state.enabled ? t("tutor.unavailable") : t("tutor.off")}
        </div>
      </div>
    );
  }

  const suggestions = [t("tutor.s1"), t("tutor.s2"), t("tutor.s3")];
  const out = state.left <= 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <TabTitle title={`🤖 ${t("tutor.title")}`} hint={t("tutor.hint")} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, padding: "6px 10px", borderRadius: 100, background: out ? "#FEE2E2" : "#EEF0FF", color: out ? "#DC2626" : ACCENT, whiteSpace: "nowrap" }}>
            {t("tutor.left").replace("{n}", String(state.left)).replace("{limit}", String(state.limit))}
          </span>
          {msgs.length > 0 && (
            <button type="button" onClick={reset} disabled={busy} style={{ border: "1px solid #EAE8E2", background: "#fff", borderRadius: 100, fontSize: 12.5, fontWeight: 700, padding: "6px 12px", cursor: "pointer", color: "#4A4E58" }}>
              🧹 {t("tutor.new")}
            </button>
          )}
        </div>
      </div>

      <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 10, minHeight: 280 }}>
        {msgs.length === 0 ? (
          <div style={{ textAlign: "center", padding: "22px 8px", color: "#6B6E78" }}>
            <div style={{ width: 56, height: 56, margin: "0 auto 10px", borderRadius: 18, background: `linear-gradient(135deg, ${ACCENT}, #7C3AED)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🤖</div>
            <div style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 17, color: "#181A1F" }}>
              {t("tutor.hello").replace("{name}", firstName || "")}
            </div>
            <div style={{ fontSize: 13.5, marginTop: 6, lineHeight: 1.55, maxWidth: 420, marginInline: "auto" }}>{t("tutor.intro")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", marginTop: 16 }}>
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={out} onClick={() => send(s)} style={{ border: "1px solid #E0E7FF", background: "#F5F6FF", color: "#3730A3", borderRadius: 100, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: out ? "default" : "pointer", textAlign: "left" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          msgs.map((m, i) =>
            m.role === "user" ? (
              <div key={i} style={{ alignSelf: "flex-end", maxWidth: "85%", background: ACCENT, color: "#fff", padding: "10px 14px", borderRadius: "16px 16px 4px 16px", fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {m.content}
              </div>
            ) : (
              <div key={i} style={{ alignSelf: "flex-start", maxWidth: "92%", display: "flex", gap: 8 }}>
                <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 9, background: "#EEF0FF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15 }}>🤖</div>
                <div style={{ background: "#F7F7F5", border: "1px solid #EFEEE9", padding: "10px 14px", borderRadius: "4px 16px 16px 16px", minWidth: 0, overflowWrap: "anywhere" }}>
                  {m.pending ? (
                    <span className="tutor-typing" aria-label={t("tutor.thinking")}>
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : (
                    <MarkdownLite text={plainMath(m.content)} style={{ fontSize: 14 }} />
                  )}
                </div>
              </div>
            ),
          )
        )}
        <div ref={endRef} />
      </div>

      {notice && (
        <div role="alert" style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 12, padding: "10px 14px", fontSize: 13.5 }}>
          {notice}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="tutor-input"
        style={{ ...card, padding: 8, display: "flex", gap: 8, alignItems: "flex-end", position: "sticky", bottom: 8, boxShadow: "0 10px 30px -18px rgba(18,19,26,0.4)" }}
      >
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 1500))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
          rows={1}
          disabled={out}
          placeholder={out ? t("tutor.limitShort") : t("tutor.placeholder")}
          style={{ flex: 1, resize: "none", border: "none", outline: "none", fontSize: 16, lineHeight: 1.45, padding: "9px 8px", maxHeight: 140, fontFamily: "inherit", background: "transparent", minWidth: 0, fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="submit"
          disabled={busy || out || !text.trim()}
          aria-label={t("tutor.send")}
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, border: "none", background: busy || out || !text.trim() ? "#C7CAD6" : ACCENT, color: "#fff", fontSize: 18, cursor: busy || out || !text.trim() ? "default" : "pointer" }}
        >
          ➤
        </button>
      </form>
      <div style={{ fontSize: 12, color: "#8A8D96", textAlign: "center" }}>{t("tutor.footer")}</div>
      <style>{`
        .tutor-typing{display:inline-flex;gap:4px;padding:4px 0;}
        .tutor-typing i{width:7px;height:7px;border-radius:50%;background:#A5A8B5;display:block;animation:tutorDot 1.2s infinite ease-in-out;}
        .tutor-typing i:nth-child(2){animation-delay:.15s}.tutor-typing i:nth-child(3){animation-delay:.3s}
        @media (max-width:640px){.tutor-input{bottom:calc(74px + env(safe-area-inset-bottom))!important;}}
        @keyframes tutorDot{0%,80%,100%{opacity:.3;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
      `}</style>
    </div>
  );
}
