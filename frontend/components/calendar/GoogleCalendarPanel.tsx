"use client";

import { useEffect, useState } from "react";
import Select from "@/components/Select";
import LoadError from "@/components/LoadError";
import { ApiError, calendarApi, type GoogleCalendarStatus } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { SCOPE_KEYS } from "./FeedLinkPanel";

const ACCENT = "var(--primary)";
const btn: React.CSSProperties = { border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: "var(--radius-sm)" };

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
      // Removed now, still being removed in the background, or left behind:
      // the panel shows which (the connection may still exist).
      const parts = [t("cal.g.disconnected").replace("{n}", String(r.removedEvents))];
      if (r.pending) parts.push(t("cal.g.cleanupPending").replace("{n}", String(r.pending)));
      if (r.notRemoved > 0) parts.push(t("cal.g.notRemoved").replace("{n}", String(r.notRemoved)));
      setMessage({ tone: r.notRemoved > 0 ? "error" : "ok", text: parts.join(" ") });
      reload();
    });
  };

  const dismiss = () =>
    run("dismiss", () => calendarApi.dismissGoogleLeftovers(), () => {
      setMessage(null);
      reload();
    });

  const c = status?.connection ?? null;
  const calendarLabel = c ? c.calendarName || (c.calendarId === "primary" || !c.calendarId ? t("cal.g.primary") : c.calendarId) : "";

  return (
    <section aria-labelledby="google-cal-title" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20, minWidth: 0 }}>
      <h2 id="google-cal-title" style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("cal.g.title")}</h2>
      <p style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, margin: "8px 0 0" }}>{t("cal.g.explain")}</p>
      <p style={{ fontSize: 13, color: "var(--text-soft)", lineHeight: 1.6, margin: "6px 0 0", fontWeight: 600 }}>{t("cal.g.oneWay")}</p>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {message && (
          <div role={message.tone === "error" ? "alert" : "status"} style={{ background: message.tone === "error" ? "var(--danger-soft)" : "var(--success-soft)", color: message.tone === "error" ? "var(--danger)" : "var(--success)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.5 }}>
            {message.text}
          </div>
        )}
        {loadError ? (
          <LoadError compact message={t("cal.loadError")} onRetry={reload} />
        ) : !status ? (
          <div role="status" style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("common.loading")}</div>
        ) : !status.configured ? (
          <div style={{ background: "var(--surface-muted)", color: "var(--text-soft)", fontSize: 13, padding: "12px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700 }}>{t("cal.g.notConfigured")}</div>
            <div>{t("cal.g.notConfiguredHint")}</div>
          </div>
        ) : !c ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("cal.g.notConnected")}</div>
            <button type="button" className="btn" disabled={busy !== null} onClick={connect} style={{ ...btn, background: ACCENT, color: "var(--on-ink)" }}>
              {busy === "connect" ? t("common.loading") : t("cal.g.connect")}
            </button>
          </div>
        ) : c.status === "DISCONNECTING" || c.status === "CLEANUP_FAILED" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
            <div role={c.status === "CLEANUP_FAILED" ? "alert" : "status"} style={{ background: c.status === "CLEANUP_FAILED" ? "var(--danger-soft)" : "var(--warning-soft)", color: c.status === "CLEANUP_FAILED" ? "var(--danger)" : "var(--warning)", fontSize: 13, fontWeight: 600, padding: "12px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.6 }}>
              {(c.status === "CLEANUP_FAILED" ? t("cal.g.cleanupFailed") : c.switching ? t("cal.g.switching") : t("cal.g.disconnecting")).replace("{n}", String(c.cleanup?.events ?? 0))}
              {c.cleanup?.from && c.cleanup.to ? <div style={{ fontWeight: 500 }}>{t("cal.g.cleanupDates").replace("{from}", formatDate(c.cleanup.from, lang, "short")).replace("{to}", formatDate(c.cleanup.to, lang, "short"))}</div> : null}
              {c.status === "DISCONNECTING" && c.lastError ? <div style={{ fontWeight: 500 }}>{t("cal.g.lastError")}: {c.lastError}{c.nextAttemptAt ? ` · ${t("cal.g.nextAttempt").replace("{date}", formatDateTime(c.nextAttemptAt, lang))}` : ""}</div> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {c.status === "CLEANUP_FAILED" ? (
                <button type="button" className="btn" disabled={busy !== null} onClick={dismiss} style={{ ...btn, background: ACCENT, color: "var(--on-ink)" }}>
                  {busy === "dismiss" ? t("common.loading") : t("cal.g.understood")}
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy !== null} onClick={reload} style={{ ...btn, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
                  {t("cal.g.refresh")}
                </button>
              )}
              <button type="button" className="btn" disabled={busy !== null} onClick={connect} style={{ ...btn, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
                {busy === "connect" ? t("common.loading") : t("cal.g.reconnect")}
              </button>
            </div>
          </div>
        ) : (
          <>
            {(c.leftoverEvents ?? 0) > 0 ? (
              <div role="status" style={{ background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13, fontWeight: 600, padding: "12px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.6, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                <span>{t("cal.g.leftover").replace("{n}", String(c.leftoverEvents))}</span>
                <button type="button" className="btn" disabled={busy !== null} onClick={dismiss} style={{ ...btn, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>{t("cal.g.understood")}</button>
              </div>
            ) : null}
            {c.status !== "ACTIVE" ? (
              <div role="alert" style={{ background: "var(--warning-soft)", color: "var(--warning)", fontSize: 13, fontWeight: 600, padding: "12px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.5 }}>
                {t("cal.g.needsReconnect")}
              </div>
            ) : null}
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))", gap: "10px 16px", margin: 0, fontSize: 13 }}>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("cal.g.status")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 700, color: c.status === "ACTIVE" ? "var(--success)" : "var(--warning)" }}>
                  {c.status === "ACTIVE" ? t("cal.g.connected") : t("cal.g.reconnectNeeded")}
                </dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("cal.g.whatIsSynced")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{t(SCOPE_KEYS[c.scope] ?? "cal.scope.CENTER")}</dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("cal.g.targetCalendar")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600, overflowWrap: "anywhere" }}>{calendarLabel}</dd>
              </div>
              <div style={{ minWidth: 0 }}>
                <dt style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("cal.g.lastSync")}</dt>
                <dd style={{ margin: "2px 0 0", fontWeight: 600 }}>{c.lastSyncAt ? formatDateTime(c.lastSyncAt, lang) : t("cal.g.notYet")}</dd>
              </div>
            </dl>
            {c.pending && c.status === "ACTIVE" && <div style={{ fontSize: 12.5, color: "var(--primary)" }}>{t("cal.g.pending")}</div>}
            {c.lastError && (
              <div style={{ fontSize: 12.5, color: "var(--danger)", overflowWrap: "anywhere" }}>
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
                  <button type="button" className="btn" disabled={busy !== null} onClick={loadCalendars} style={{ ...btn, background: "var(--surface-muted)", color: "var(--text)" }}>
                    {busy === "calendars" ? t("common.loading") : t("cal.g.chooseCalendar")}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {c.status === "ACTIVE" ? (
                <button type="button" className="btn" disabled={busy !== null} onClick={syncNow} style={{ ...btn, background: ACCENT, color: "var(--on-ink)" }}>
                  {busy === "sync" ? t("common.loading") : t("cal.g.syncNow")}
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy !== null} onClick={connect} style={{ ...btn, background: ACCENT, color: "var(--on-ink)" }}>
                  {busy === "connect" ? t("common.loading") : t("cal.g.reconnect")}
                </button>
              )}
              <button type="button" className="btn" disabled={busy !== null} onClick={disconnect} style={{ ...btn, background: "var(--danger-soft)", color: "var(--danger)" }}>
                {busy === "disconnect" ? t("common.loading") : t("cal.g.disconnect")}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
