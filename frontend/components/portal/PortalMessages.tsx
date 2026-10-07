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
  URGENT: { bar: "#DC2626", bg: "#FEE2E2", color: "#B91C1C", key: "pms.urgent" },
  HIGH: { bar: "#F59E0B", bg: "#FEF3C7", color: "#B45309", key: "pms.important" },
  NORMAL: { bar: ACCENT, bg: "#EEF0FF", color: ACCENT, key: null },
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
          <button type="button" onClick={() => onRead()} style={{ background: "#fff", border: `1.5px solid ${ACCENT}`, color: ACCENT, borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>
            ✓ {t("pms.readAll")}
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, background: "#F2F1EC", padding: 4, borderRadius: 12, alignSelf: "flex-start" }}>
        {(["all", "unread"] as const).map((f) => (
          <button key={f} type="button" onClick={() => setFilter(f)} style={{ border: "none", cursor: "pointer", padding: "7px 14px", borderRadius: 9, fontSize: 13, fontWeight: 700, background: filter === f ? "#fff" : "transparent", color: filter === f ? "#181A1F" : "#6B6E78", boxShadow: filter === f ? "0 1px 3px rgba(0,0,0,0.08)" : "none", display: "inline-flex", gap: 6, alignItems: "center" }}>
            {f === "all" ? t("common.all") : t("pms.unread")}
            {f === "all" ? <span style={{ color: "#686B75" }}>{announcements.length}</span> : unread > 0 && <span style={{ background: "#EF4444", color: "#fff", fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 100 }}>{unread}</span>}
          </button>
        ))}
      </div>

      {debt && (
        <div style={{ background: "linear-gradient(135deg, #FFFBEB, #FEF3C7)", border: "1.5px solid #FDE68A", borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#fff", display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>💳</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: "#92400E" }}>{t("ptl.payDue")}</div>
              <div style={{ fontSize: 12.5, color: "#78350F" }}>
                {t("ptl.debtNotice")} <b>{new Intl.NumberFormat("uz-UZ").format(debt.amount)} {t("common.sumUnit")}</b> ({debt.forMonth})
              </div>
            </div>
          </div>
          <button type="button" onClick={onPay} style={{ background: "#D97706", color: "#fff", border: "none", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{t("ptl.pay")}</button>
        </div>
      )}

      {list.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: "40px 20px", textAlign: "center" }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{t("ptl.noNotifs")}</div>
          <div style={{ fontSize: 13, color: "#686B75", marginTop: 4 }}>{t("ptl.allRead")}</div>
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
                style={{ position: "relative", background: a.read ? "#fff" : "#FBFBFF", border: `1px solid ${a.read ? "#EAE8E2" : "#C7D2FE"}`, borderRadius: 16, padding: "14px 16px 14px 18px", cursor: "pointer", overflow: "hidden", display: "flex", flexDirection: "column", gap: 8, boxShadow: a.read ? "none" : "0 6px 18px -12px rgba(79,70,229,0.5)" }}
              >
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: p.bar }} />
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 11.5, color: "#686B75" }}>{formatDateTime(a.createdAt, lang)}</span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {p.key && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "2px 8px", borderRadius: 100, background: p.bg, color: p.color }}>{t(p.key)}</span>}
                    {!a.read && <span title={t("pms.new")} style={{ width: 9, height: 9, borderRadius: "50%", background: "#EF4444" }} />}
                  </span>
                </div>
                <div style={{ fontSize: 15, fontWeight: a.read ? 700 : 800, color: "#181A1F", overflowWrap: "anywhere" }}>{a.title}</div>
                <div style={{ fontSize: 13.5, color: "#4A4E58", lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere", ...(expanded ? {} : { display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }) }}>
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
