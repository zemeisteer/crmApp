"use client";

import { useState } from "react";
import type { PortalAnnouncement } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDateTime } from "@/lib/format-date";
import { PORTAL_ACCENT as ACCENT, TabTitle } from "@/components/portal/PortalTabs";

// Center news in the cabinet: a card grid (two or three per row on wide
// screens), unread ones marked and counted, "mark all as read", and the debt
// reminder on top while money is owed.
const CSS = `
.pms-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
@media (min-width:700px){.pms-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.pms-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;

const PRIORITY: Record<string, { bar: string; bg: string; color: string; key: "pms.urgent" | "pms.important" | null }> = {
  URGENT: { bar: "var(--danger)", bg: "var(--danger-soft)", color: "var(--danger)", key: "pms.urgent" },
  HIGH: { bar: "var(--warning)", bg: "var(--warning-soft)", color: "var(--warning)", key: "pms.important" },
  NORMAL: { bar: ACCENT, bg: "var(--primary-soft)", color: ACCENT, key: null },
};

export default function PortalMessages({
  announcements,
  debt,
  onPay,
  onRead,
}: {
  announcements: PortalAnnouncement[];
  debt: { amount: number; forMonth: string } | null;
  onPay: () => void;
  onRead: (id?: string) => void;
}) {
  const { t, lang } = useLanguage();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [open, setOpen] = useState<string | null>(null);
  const unread = announcements.filter((a) => !a.read).length;
  const list = filter === "unread" ? announcements.filter((a) => !a.read) : announcements;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <TabTitle title={t("ptl.notifTitle")} hint={t("ptl.notifHint")} />
        {unread > 0 && (
          <button type="button" onClick={() => onRead()} style={{ background: "var(--surface)", border: `1.5px solid ${ACCENT}`, color: ACCENT, borderRadius: "var(--radius-sm)", padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            ✓ {t("pms.readAll")}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, background: "var(--surface-muted)", padding: 4, borderRadius: "var(--radius-md)", alignSelf: "flex-start" }}>
        {(["all", "unread"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} style={{ border: "none", cursor: "pointer", padding: "7px 14px", borderRadius: "var(--radius-sm)", fontSize: 13, fontWeight: 700, background: filter === f ? "var(--surface)" : "transparent", color: filter === f ? "var(--text)" : "var(--text-muted)", boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
            {f === "all" ? t("common.all") : t("pms.unread")}
            {f === "all" ? <span style={{ color: "var(--text-muted)" }}>{announcements.length}</span> : unread > 0 && <span style={{ background: "var(--danger)", color: "var(--on-ink)", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: "var(--radius-pill)" }}>{unread}</span>}
          </button>
        ))}
      </div>

      {debt && (
        <div style={{ background: "linear-gradient(135deg, var(--warning-soft), var(--warning-soft))", border: "1.5px solid var(--warning-border)", borderRadius: "var(--radius-lg)", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: "var(--radius-md)", background: "var(--surface)", display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>💳</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--warning)" }}>{t("ptl.payDue")}</div>
              <div style={{ fontSize: 12.5, color: "var(--warning)" }}>
                {t("ptl.debtNotice")} <b>{new Intl.NumberFormat("uz-UZ").format(debt.amount)} {t("common.sumUnit")}</b> ({debt.forMonth})
              </div>
            </div>
          </div>
          <button type="button" onClick={onPay} style={{ background: "var(--warning)", color: "var(--on-ink)", border: "none", borderRadius: "var(--radius-sm)", padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("ptl.pay")}</button>
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("ptl.noNotifs")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{t("ptl.allRead")}</div>
        </div>
      ) : (
        <div className="pms-grid">
          {list.map((a) => {
            const p = PRIORITY[a.priority] ?? PRIORITY.NORMAL;
            const expanded = open === a.id;
            const long = a.content.length > 180;
            return (
              <article
                key={a.id}
                onClick={() => { setOpen(expanded ? null : a.id); if (!a.read) onRead(a.id); }}
                style={{ position: "relative", background: a.read ? "var(--surface)" : "var(--primary-soft)", border: `1px solid ${a.read ? "var(--border)" : "var(--primary-border)"}`, borderRadius: "var(--radius-lg)", padding: "14px 16px 14px 18px", cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column", gap: 8, boxShadow: a.read ? "none" : "0 6px 18px -12px rgba(79,70,229,0.5)" }}
              >
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: p.bar }} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{formatDateTime(a.createdAt, lang)}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {p.key && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: "var(--radius-pill)", background: p.bg, color: p.color }}>{t(p.key)}</span>}
                    {!a.read && <span title={t("pms.new")} style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--danger)" }} />}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: a.read ? 700 : 800, color: "var(--text)", overflowWrap: "anywhere" }}>{a.title}</div>
                <div style={{ fontSize: 13.5, color: "var(--text-soft)", lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...(expanded ? {} : { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }) }}>
                  {a.content}
                </div>
                {long && <span style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT }}>{expanded ? t("pms.less") : t("pms.more")}</span>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
