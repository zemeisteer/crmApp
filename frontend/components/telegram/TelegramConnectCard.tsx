"use client";

import { useEffect, useState } from "react";
import { telegramApi } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import { useAuth } from "@/lib/auth-context";

// Lets the signed-in staff member connect their own Telegram so CRM
// reminders (new website applications, follow-ups, trials) reach them there.
export default function TelegramConnectCard() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [state, setState] = useState<{ configured: boolean; linked: boolean } | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    telegramApi.myStatus().then((s) => setState({ configured: s.configured, linked: s.linked })).catch(() => setState(null));

  useEffect(() => {
    refresh();
  }, []);

  if (!state) return null;
  // Only admins can fix a missing bot, so only they see that note.
  if (!state.configured) {
    return user?.role === "ADMIN" || user?.role === "OWNER" ? (
      <div style={{ fontSize: 12, color: "#8A8D96" }}>📨 {t("tg.title")}: {t("tg.notConfigured")}</div>
    ) : null;
  }

  async function connect() {
    setBusy(true);
    try {
      const { linkUrl } = await telegramApi.myLink();
      if (linkUrl) window.open(linkUrl, "_blank", "noopener");
      setWaiting(true);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      await telegramApi.myUnlink();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const btn: React.CSSProperties = { border: "1px solid #C7D2FE", background: "#EEF0FF", color: "#4F46E5", fontWeight: 700, fontSize: 12, padding: "6px 12px", borderRadius: 8, cursor: "pointer" };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#fff", border: "1px solid #EAE8E2", borderRadius: 12, padding: "10px 14px", fontSize: 13 }}>
      <span style={{ fontWeight: 700 }}>✈️ {t("tg.title")}</span>
      <span style={{ color: state.linked ? "#15803D" : "#5B5F6A", flex: 1, minWidth: 200 }}>
        {state.linked ? t("tg.linkedText") : waiting ? t("tg.openHint") : t("tg.unlinkedText")}
      </span>
      {state.linked ? (
        <button type="button" className="btn" style={{ ...btn, background: "#fff", color: "#B91C1C", borderColor: "#FECACA" }} disabled={busy} onClick={disconnect}>
          {t("tg.disconnect")}
        </button>
      ) : (
        <>
          <button type="button" className="btn" style={btn} disabled={busy} onClick={connect}>{t("tg.connect")}</button>
          {waiting && (
            <button type="button" className="btn" style={{ ...btn, background: "#fff" }} onClick={() => refresh().then(() => setWaiting(false))}>
              {t("tg.check")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
