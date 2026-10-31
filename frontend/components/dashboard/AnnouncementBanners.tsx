"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Modal from "@/components/Modal";
import { announcementsApi, type AnnouncementBanner } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { formatDate } from "@/lib/format-date";

// Urgent/important announcements on top of the dashboard. They are
// temporary: only the last few days' unread ones come back from the server,
// and opening or dismissing one marks it read, so it does not return.
export default function AnnouncementBanners() {
  const { t, lang } = useLanguage();
  const [items, setItems] = useState<AnnouncementBanner[]>([]);
  const [open, setOpen] = useState<AnnouncementBanner | null>(null);

  useEffect(() => {
    announcementsApi.banners().then(setItems).catch(() => setItems([]));
  }, []);

  function markRead(id: string) {
    setItems((prev) => prev.filter((x) => x.id !== id));
    announcementsApi.markRead(id).catch(() => undefined);
  }

  if (items.length === 0 && !open) return null;

  return (
    <>
      <div className="flex flex-col gap-2.5">
        {items.map((b) => {
          const urgent = b.priority === "URGENT";
          return (
            <div
              key={b.id}
              className={`rounded-2xl p-4 flex items-center justify-between gap-3 border transition ${
                urgent ? "bg-danger-soft border-danger-border text-danger" : "bg-warning-soft border-warning-border text-warning"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${urgent ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m3 11 18-5v12L3 14v-3z" />
                    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0 ${urgent ? "bg-danger text-white" : "bg-warning text-fg"}`}>
                      {urgent ? t("ann.urgent") : t("ann.important")}
                    </span>
                    <span className={`text-sm font-bold truncate ${urgent ? "text-danger" : "text-warning"}`}>{b.title}</span>
                  </div>
                  <p className={`text-xs truncate mt-0.5 max-w-xl font-medium ${urgent ? "text-danger" : "text-warning"}`}>{b.content}</p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(b);
                    markRead(b.id);
                  }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-xl border transition ${
                    urgent ? "bg-surface border-danger-border text-danger hover:bg-danger-soft" : "bg-surface border-warning-border text-warning hover:bg-warning-soft"
                  }`}
                >
                  {t("ann.details")} →
                </button>
                <button
                  type="button"
                  aria-label={t("ann.dismiss")}
                  title={t("ann.dismiss")}
                  onClick={() => markRead(b.id)}
                  className={`w-8 h-8 rounded-xl flex items-center justify-center transition ${urgent ? "text-danger hover:bg-danger-soft" : "text-warning hover:bg-warning-soft"}`}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <Modal open onClose={() => setOpen(null)} title={open.title} width={520}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: -6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
              <span
                style={{
                  fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", padding: "3px 8px", borderRadius: "var(--radius-pill)",
                  ...(open.priority === "URGENT" ? { background: "var(--danger)", color: "var(--on-ink)" } : { background: "var(--warning)", color: "var(--text)" }),
                }}
              >
                {open.priority === "URGENT" ? t("ann.urgent") : t("ann.important")}
              </span>
              {formatDate(new Date(open.publishedAt), lang, "long")}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--text)", whiteSpace: "pre-wrap" }}>{open.content}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 4 }}>
              <Link href="/announcements" style={{ fontSize: 13, fontWeight: 700, color: "var(--primary)" }}>
                {t("ann.allNews")} →
              </Link>
              <button type="button" className="btn" onClick={() => setOpen(null)} style={{ background: "var(--primary)", color: "var(--on-ink)", border: "none", fontSize: 13, fontWeight: 700, padding: "9px 16px", borderRadius: "var(--radius-sm)" }}>
                {t("ann.gotIt")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
