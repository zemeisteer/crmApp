"use client";

import { useEffect, useState } from "react";
import Select from "@/components/Select";
import LoadError from "@/components/LoadError";
import { ApiError, calendarApi, type GoogleCalendarStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format-date";
import { SCOPE_KEYS } from "./FeedLinkPanel";

const ACCENT = "#4F46E5";
const btn: React.CSSProperties = { border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9 };

const CODE_KEYS: Record<string, TranslationKey> = {
  GOOGLE_NOT_CONFIGURED: "cal.g.err.GOOGLE_NOT_CONFIGURED",
  NEEDS_RECONNECT: "cal.g.err.NEEDS_RECONNECT",
  GOOGLE_UNAVAILABLE: "cal.g.err.GOOGLE_UNAVAILABLE",
};

function googleError(err: unknown, t: (k: TranslationKey) => string) {
  const code = err instanceof ApiError && typeof err.body?.code === "string" ? err.body.code : null;
  if (code && CODE_KEYS[code]) return t(CODE_KEYS[code]);
  if (err instanceof ApiError && err.status === 404) return t("cal.g.err.notConnected");
  return t("common.errorGeneric");
}

/**
 * Google Calendar, one way: the person's lessons are written into a
 * calendar of their Google account and kept up to date by the server.
 * Nothing done in Google comes back. Available only when the server has
 * Google credentials.
 */
export default function GoogleCalendarPanel() {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [calendars, setCalendars] = useState<Array<{ id: string; summary: string; primary?: boolean }> | null>(null);

  useEffect(() => {
    let alive = true;
    calendarApi
      .google()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [nonce]);
  const reload = () => setNonce((n) => n + 1);

  async function run<T>(name: string, fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(name);
    setMessage(null);
    try {
      const r = await fn();
      after?.(r);
    } catch (err) {
      setMessage({ tone: "error", text: googleError(err, t) });
      reload();
    } finally {
      setBusy(null);
    }
  }

  const connect = () =>
    run("connect", () => calendarApi.connectGoogle("/calendar"), (r) => {
      // Google's consent screen; it sends the browser back to /calendar?google=...
      window.location.assign(r.url);
    });

  const loadCalendars = () => run("calendars", () => calendarApi.googleCalendars(), (list) => setCalendars(list));

  const choose = (id: string) =>
    run("choose", () => calendarApi.chooseGoogleCalendar(id), (s) => {
      setStatus(s);
      setMessage({ tone: "ok", text: t("cal.g.calendarChosen") });
    });

  const syncNow = () =>
    run("sync", () => calendarApi.syncGoogle(), (s) => {
      setStatus(s);
      setMessage({ tone: "ok", text: t("cal.g.syncQueued") });
    });

  const disconnect = () => {
    if (!window.confirm(t("cal.g.confirmDisconnect"))) return;
    void run("disconnect", () => calendarApi.disconnectGoogle(), (r) => {
      setCalendars(null);
      setStatus((s) => (s ? { ...s, connection: null } : s));
      const text = t("cal.g.disconnected").replace("{n}", String(r.removedEvents));
      setMessage({ tone: "ok", text: r.notRemoved > 0 ? `${text} ${t("cal.g.notRemoved").replace("{n}", String(r.notRemoved))}` : text });
    });
  };

  const c = status?.connection ?? null;
  const calendarLabel = c ? c.calendarName || (c.calendarId === "primary" || !c.calendarId ? t("cal.g.primary") : c.calendarId) : "";

  return (
    <section aria-labelledby="google-cal-title" style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, minWidth: 0 }}>
      <h2 id="google-cal-title" style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("cal.g.title")}</h2>
      <p style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6, margin: "8px 0 0" }}>{t("cal.g.explain")}</p>
      <p style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6, margin: "6px 0 0", fontWeight: 600 }}>{t("cal.g.oneWay")}</p>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {message && (
          <div role={message.tone === "error" ? "alert" : "status"} style={{ background: message.tone === "error" ? "#FDEBEC" : "#E9F8EF", color: message.tone === "error" ? "#B23A47" : "#167A48", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, lineHeight: 1.5 }}>
            {message.text}
          </div>
        )}
        {loadError ? (
          <LoadError compact message={t("cal.loadError")} onRetry={reload} />
        ) : !status ? (
          <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
        ) : !status.configured ? (
          <div style={{ background: "#F2F1EC", color: "#4A4E58", fontSize: 13, padding: "12px 14px", borderRadius: 10, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>{t("cal.g.notConfigured")}</div>
            <div>{t("cal.g.notConfiguredHint")}</div>
          </div>
        ) : !c ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <div style={{ fontSize: 13, color: "#686B75" }}>{t("cal.g.notConnected")}</div>
            <button type="button" className="btn" disabled={busy !== null} onClick={connect} style={{ ...btn, background: ACCENT, color: "#fff" }}>
              {busy === "connect" ? t("common.loading") : t("cal.g.connect")}
            </button>
          </div>
        ) : (
          <>
            {c.status !== "ACTIVE" ? (
              <div role="alert" style={{ background: "#FFF7E6", color: "#A15C00", fontSize: 13, fontWeight: 600, padding: "12px 14px", borderRadius: 10, lineHeight: 1.5 }}>
                {t("cal.g.needsReconnect")}
              </div>
            ) : null}
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: "10px 16px", margin: 0, fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "#686B75", fontSize: 12 }}>{t("cal.g.status")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 700, color: c.status === "ACTIVE" ? "#167A48" : "#A15C00" }}>
                  {c.status === "ACTIVE" ? t("cal.g.connected") : t("cal.g.reconnectNeeded")}
                </dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "#686B75", fontSize: 12 }}>{t("cal.g.whatIsSynced")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{t(SCOPE_KEYS[c.scope] ?? "cal.scope.CENTER")}</dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "#686B75", fontSize: 12 }}>{t("cal.g.targetCalendar")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600, overflowWrap: "anywhere" }}>{calendarLabel}</dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "#686B75", fontSize: 12 }}>{t("cal.g.lastSync")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{c.lastSyncAt ? formatDateTime(c.lastSyncAt, lang) : t("cal.g.notYet")}</dd>
              </div>
            </dl>
            {c.pending && c.status === "ACTIVE" && <div style={{ fontSize: 12.5, color: "#3730A3" }}>{t("cal.g.pending")}</div>}
            {c.lastError && (
              <div style={{ fontSize: 12.5, color: "#B23A47", overflowWrap: "anywhere" }}>
                {t("cal.g.lastError")}: {c.lastError}
                {c.nextAttemptAt ? ` · ${t("cal.g.nextAttempt").replace("{date}", formatDateTime(c.nextAttemptAt, lang))}` : ""}
              </div>
            )}

            {c.status === "ACTIVE" && (
              <div role="group" aria-label={t("cal.g.targetCalendar")} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {calendars ? (
                  <div style={{ flex: "1 1 240px", maxWidth: 360, minWidth: 0 }}>
                    <Select
                      ariaLabel={t("cal.g.targetCalendar")}
                      disabled={busy !== null}
                      options={calendars.map((x) => ({ value: x.id, label: x.primary ? `${x.summary} (${t("cal.g.primary")})` : x.summary }))}
                      value={calendars.some((x) => x.id === c.calendarId) ? c.calendarId ?? "" : calendars.find((x) => x.primary && c.calendarId === "primary")?.id ?? ""}
                      onChange={(id) => void choose(id)}
                    />
                  </div>
                ) : (
                  <button type="button" className="btn" disabled={busy !== null} onClick={loadCalendars} style={{ ...btn, background: "#F2F1EC", color: "#181A1F" }}>
                    {busy === "calendars" ? t("common.loading") : t("cal.g.chooseCalendar")}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {c.status === "ACTIVE" ? (
                <button type="button" className="btn" disabled={busy !== null} onClick={syncNow} style={{ ...btn, background: ACCENT, color: "#fff" }}>
                  {busy === "sync" ? t("common.loading") : t("cal.g.syncNow")}
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy !== null} onClick={connect} style={{ ...btn, background: ACCENT, color: "#fff" }}>
                  {busy === "connect" ? t("common.loading") : t("cal.g.reconnect")}
                </button>
              )}
              <button type="button" className="btn" disabled={busy !== null} onClick={disconnect} style={{ ...btn, background: "#FDEBEC", color: "#B23A47" }}>
                {busy === "disconnect" ? t("common.loading") : t("cal.g.disconnect")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
