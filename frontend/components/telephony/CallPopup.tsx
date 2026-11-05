"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { callsApi, type CallCard, type LeadStatus } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";
import { statusKey } from "@/components/leads/lead-ui";
import { useLanguage } from "@/lib/i18n-context";
import Badge from "@/components/ui/Badge";
import { callNoteText, prettyPhone, useCallsMe } from "./useCallsMe";

type Phase = "ringing" | "answered" | "ended";
interface Shown {
  callId: string;
  phase: Phase;
  card: CallCard | null;
}

const KIND_KEY = { LEAD: "tel.kindLead", STUDENT: "tel.kindStudent", PARENT: "tel.kindParent" } as const;

/**
 * The incoming-call popup: opens when a call rings this member's extension,
 * with the caller's card (who it is, status, latest notes, a link to the
 * card). It says when the call is taken and closes a little after the call
 * ends. Fed by /api/calls/stream; the card is fetched (and checked) on its own.
 */
export default function CallPopup() {
  const { t } = useLanguage();
  const me = useCallsMe();
  const [shown, setShown] = useState<Shown[]>([]);
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!me.canView) return;
    const timersNow = timers.current;
    const handle = callsApi.stream({
      onEvent: (e) => {
        if (e.event !== "call") return;
        let data: { callId?: string; phase?: Phase };
        try {
          data = JSON.parse(e.data);
        } catch {
          return;
        }
        const { callId, phase } = data;
        if (!callId || !phase) return;
        setShown((prev) => {
          const existing = prev.find((s) => s.callId === callId);
          if (!existing && phase !== "ringing") return prev;
          if (existing) return prev.map((s) => (s.callId === callId ? { ...s, phase } : s));
          return [...prev, { callId, phase, card: null }].slice(-3);
        });
        if (phase === "ringing") {
          callsApi.card(callId).then(
            (card) => setShown((prev) => prev.map((s) => (s.callId === callId ? { ...s, card } : s))),
            () => undefined,
          );
        }
        if (phase === "ended") {
          window.clearTimeout(timersNow.get(callId));
          timersNow.set(callId, window.setTimeout(() => setShown((prev) => prev.filter((s) => s.callId !== callId)), 8000));
        }
      },
    });
    return () => {
      handle.close();
      for (const id of timersNow.values()) window.clearTimeout(id);
    };
  }, [me.canView]);

  if (shown.length === 0) return null;
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 60, display: "flex", flexDirection: "column", gap: 10, width: "min(360px, calc(100vw - 32px))" }}>
      {shown.map((s) => {
        const c = s.card?.contact;
        const number = prettyPhone(s.card?.call.clientNumber);
        return (
          <section
            key={s.callId}
            data-testid="call-popup"
            role="region"
            aria-live="assertive"
            aria-label={t("tel.popupTitle")}
            className="rise-in"
            style={{ background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-pop)", padding: "14px 16px", display: "grid", gap: 8 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: s.phase === "ringing" ? "var(--success)" : "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <span aria-hidden>{s.phase === "ringing" ? "📞 " : s.phase === "answered" ? "🎧 " : "☎ "}</span>
                {t(s.phase === "ringing" ? "tel.popupRinging" : s.phase === "answered" ? "tel.popupAnswered" : "tel.popupEnded")}
              </span>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setShown((prev) => prev.filter((x) => x.callId !== s.callId))}
                style={{ border: "none", background: "var(--surface-muted)", color: "var(--text-muted)", width: 26, height: 26, borderRadius: "50%", cursor: "pointer", fontSize: 15 }}
              >
                ×
              </button>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>{c?.name ?? number}</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>
                {c && c.name !== number ? number : null}
                {c && c.name !== number && s.card && s.card.previousCalls > 0 ? " · " : ""}
                {s.card && s.card.previousCalls > 0 ? t("tel.previousCalls").replace("{n}", String(s.card.previousCalls)) : ""}
              </div>
            </div>
            {c && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge tone={c.kind === "LEAD" ? "accent" : c.kind === "PARENT" ? "violet" : "info"}>{t(KIND_KEY[c.kind])}</Badge>
                <Badge>{t(c.kind === "LEAD" ? statusKey(c.status as LeadStatus) : (`stStatus.${c.status}` as TranslationKey))}</Badge>
                {s.card?.call.createdLead && <Badge tone="success">{t("tel.newLead")}</Badge>}
              </div>
            )}
            {c && (c.notes || c.recent.length > 0) && (
              <ul style={{ listStyle: "none", margin: 0, padding: "8px 10px", background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", fontSize: 12.5, color: "var(--text-soft)", display: "grid", gap: 4 }}>
                {c.notes && <li>📝 {c.notes.slice(0, 160)}</li>}
                {c.recent.slice(0, 2).map((r, i) => <li key={i}>• {(callNoteText(r.metadata, t) ?? r.body ?? "").slice(0, 120)}</li>)}
              </ul>
            )}
            {!s.card && <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>…</div>}
            {c && (
              <Link href={c.href} className="btn btn-primary btn-sm" style={{ justifySelf: "start" }} onClick={() => setShown((prev) => prev.filter((x) => x.callId !== s.callId))}>
                {t("tel.openCard")}
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}
