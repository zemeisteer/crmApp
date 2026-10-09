"use client";

import { useEffect, useState } from "react";
import DashboardShell from "@/components/DashboardShell";
import FeedLinkPanel from "@/components/calendar/FeedLinkPanel";
import GoogleCalendarPanel from "@/components/calendar/GoogleCalendarPanel";
import { calendarApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { googleReturn, type GoogleReturn } from "@/lib/makeups";

const RETURN_TEXT: Record<GoogleReturn, { key: TranslationKey; ok: boolean }> = {
  connected: { key: "cal.g.returnConnected", ok: true },
  denied: { key: "cal.g.returnDenied", ok: false },
  expired: { key: "cal.g.returnExpired", ok: false },
  error: { key: "cal.g.returnError", ok: false },
};

function CalendarContent() {
  const { t } = useLanguage();
  // Back from Google's consent screen: ?google=connected|denied|expired|error.
  // (The shell renders this only in the browser, once the session is known.)
  const [returned] = useState<GoogleReturn | null>(() => (typeof window === "undefined" ? null : googleReturn(window.location.search)));
  useEffect(() => {
    // A reload must not show the message again.
    if (returned) window.history.replaceState(null, "", window.location.pathname);
  }, [returned]);

  return (
    <>
      <div style={{ padding: "22px 32px", borderBottom: "1px solid #EAE8E2" }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>{t("cal.title")}</h1>
        <div style={{ fontSize: 13, color: "#686B75", marginTop: 2, lineHeight: 1.5 }}>{t("cal.subtitle")}</div>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "20px 32px", overflow: "auto", boxSizing: "border-box" }}>
        <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {returned && (
            <div
              role={RETURN_TEXT[returned].ok ? "status" : "alert"}
              style={{
                background: RETURN_TEXT[returned].ok ? "#E9F8EF" : "#FDEBEC",
                color: RETURN_TEXT[returned].ok ? "#167A48" : "#B23A47",
                fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, lineHeight: 1.5,
              }}
            >
              {t(RETURN_TEXT[returned].key)}
            </div>
          )}
          <FeedLinkPanel api={calendarApi} />
          <GoogleCalendarPanel />
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  return (
    <DashboardShell>
      <CalendarContent />
    </DashboardShell>
  );
}
