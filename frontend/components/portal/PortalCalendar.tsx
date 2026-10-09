"use client";

import Link from "next/link";
import FeedLinkPanel from "@/components/calendar/FeedLinkPanel";
import { portalCalendarApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

/**
 * The cabinet's calendar link: the student's lessons and make-ups as a
 * read-only calendar a phone's calendar app can subscribe to. A parent who
 * opened the cabinet from their own account is also pointed to their own
 * calendar page, one link for all their children.
 */
export default function PortalCalendar({ parentAccount = false }: { parentAccount?: boolean }) {
  const { t } = useLanguage();
  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {parentAccount && (
        <section aria-labelledby="ptl-parent-cal-title" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, minWidth: 0 }}>
          <h2 id="ptl-parent-cal-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("ptl.parentCal.title")}</h2>
          <p style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6, margin: "8px 0 12px" }}>{t("ptl.parentCal.hint")}</p>
          <Link
            href="/calendar"
            className="btn"
            style={{ display: "inline-block", background: "#4F46E5", color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9, textDecoration: "none", maxWidth: "100%", overflowWrap: "anywhere" }}
          >
            {t("ptl.parentCal.open")}
          </Link>
        </section>
      )}
      <FeedLinkPanel api={portalCalendarApi} />
    </div>
  );
}
