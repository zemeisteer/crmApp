"use client";

import { useEffect, useId, useRef, useState } from "react";
import LoadError from "@/components/LoadError";
import type { CalendarFeedCreated, CalendarFeedInfo, CalendarScope } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { googleSubscribeUrl, webcalUrl } from "@/lib/makeups";

const ACCENT = "#4F46E5";

export interface FeedApi {
  feed: () => Promise<{ scope: CalendarScope; feed: CalendarFeedInfo | null }>;
  createFeed: () => Promise<CalendarFeedCreated>;
  revokeFeed: () => Promise<unknown>;
}

export const SCOPE_KEYS: Record<CalendarScope, TranslationKey> = {
  TEACHER: "cal.scope.TEACHER",
  PARENT: "cal.scope.PARENT",
  CENTER: "cal.scope.CENTER",
  STUDENT: "cal.scope.STUDENT",
};

const btn: React.CSSProperties = { border: "none", fontSize: 13, fontWeight: 700, padding: "9px 14px", borderRadius: 9, cursor: "pointer" };
const linkBtn: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 12.5, fontWeight: 700, padding: "8px 12px", borderRadius: 8, textDecoration: "none" };

/**
 * A read-only subscription link (ICS) to one person's lessons: make it,
 * copy it once, add it to a calendar app, make a new one, turn it off.
 * The server keeps only a hash: the full link exists only in the answer
 * to "make", so it is shown once.
 */
export default function FeedLinkPanel({ api, headingLevel = 2 }: { api: FeedApi; headingLevel?: 2 | 3 }) {
  const { t, lang } = useLanguage();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ scope: CalendarScope; feed: CalendarFeedInfo | null } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .feed()
      .then((s) => {
        if (!alive) return;
        setState(s);
        setLoadError(false);
      })
      .catch(() => alive && setLoadError(true));
    return () => {
      alive = false;
    };
  }, [api, nonce]);

  async function create() {
    if (state?.feed && !window.confirm(t("cal.confirmNewLink"))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    setCopied(null);
    try {
      const made = await api.createFeed();
      setUrl(made.url);
      setState((s) => ({ scope: s?.scope ?? made.scope, feed: { id: made.id, scope: made.scope, tokenHint: made.tokenHint, createdAt: made.createdAt, lastFetchedAt: null } }));
    } catch {
      setError(t("cal.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm(t("cal.confirmTurnOff"))) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.revokeFeed();
      setUrl(null);
      setCopied(null);
      setNotice(t("cal.turnedOff"));
      setState((s) => (s ? { ...s, feed: null } : s));
    } catch {
      setError(t("common.errorGeneric"));
      setNonce((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      // No clipboard access (an insecure address, a denied permission): select it for the reader.
      inputRef.current?.focus();
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  const H = headingLevel === 2 ? "h2" : "h3";
  const feed = state?.feed ?? null;
  return (
    <section aria-labelledby={`${inputId}-title`} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 20, minWidth: 0 }}>
      <H id={`${inputId}-title`} style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 700, fontSize: 16, margin: 0 }}>{t("cal.feedTitle")}</H>
      {state && <div style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT, marginTop: 4 }}>{t(SCOPE_KEYS[state.scope])}</div>}
      <div style={{ fontSize: 13, color: "#4A4E58", lineHeight: 1.6, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <p style={{ margin: 0 }}>{t("cal.feedExplain")}</p>
        <p style={{ margin: 0 }}>{t("cal.feedRefresh")}</p>
        <p style={{ margin: 0 }}>{t("cal.feedPrivate")}</p>
      </div>

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        {error && <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>}
        {notice && <div role="status" style={{ background: "#E9F8EF", color: "#167A48", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{notice}</div>}
        {loadError ? (
          <LoadError compact message={t("cal.loadError")} onRetry={() => setNonce((n) => n + 1)} />
        ) : !state ? (
          <div role="status" style={{ fontSize: 13, color: "#686B75" }}>{t("common.loading")}</div>
        ) : (
          <>
            {url ? (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <label htmlFor={inputId} style={{ fontSize: 12.5, fontWeight: 700, color: "#4A4E58" }}>{t("cal.yourLink")}</label>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input
                    id={inputId}
                    ref={inputRef}
                    className="field-input"
                    readOnly
                    value={url}
                    onFocus={(e) => e.currentTarget.select()}
                    style={{ flex: "1 1 220px", minWidth: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
                  />
                  <button type="button" className="btn" onClick={copy} style={{ ...btn, background: ACCENT, color: "#fff" }}>
                    {t("cal.copy")}
                  </button>
                </div>
                <div aria-live="polite" style={{ fontSize: 12.5, fontWeight: 600, color: copied === "ok" ? "#167A48" : "#A15C00", minHeight: copied ? undefined : 0 }}>
                  {copied === "ok" ? t("cal.copied") : copied === "manual" ? t("cal.copyManual") : null}
                </div>
                <div style={{ fontSize: 12.5, color: "#A15C00", fontWeight: 600 }}>{t("cal.shownOnce")}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <a href={googleSubscribeUrl(url)} target="_blank" rel="noopener noreferrer" style={linkBtn}>
                    {t("cal.addGoogle")} <span aria-hidden>↗</span>
                  </a>
                  <a href={webcalUrl(url)} style={linkBtn}>{t("cal.addApple")}</a>
                </div>
                <div style={{ fontSize: 12, color: "#686B75", lineHeight: 1.5 }}>{t("cal.addHint")}</div>
              </div>
            ) : feed ? (
              <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14, fontSize: 13, lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700 }}>{t("cal.linkOn")}</div>
                <div style={{ color: "#4A4E58" }}>
                  {t("cal.linkStarts").replace("{hint}", feed.tokenHint)} · {t("cal.linkMade").replace("{date}", formatDate(feed.createdAt, lang, "short"))}
                </div>
                <div style={{ color: "#4A4E58" }}>
                  {feed.lastFetchedAt ? t("cal.lastFetched").replace("{date}", formatDateTime(feed.lastFetchedAt, lang)) : t("cal.neverFetched")}
                </div>
                <div style={{ color: "#686B75", marginTop: 4 }}>{t("cal.linkHidden")}</div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: "#686B75" }}>{t("cal.noLink")}</div>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button type="button" className="btn" disabled={busy} onClick={create} style={{ ...btn, background: feed ? "#F2F1EC" : ACCENT, color: feed ? "#181A1F" : "#fff" }}>
                {busy ? t("common.loading") : feed ? t("cal.newLink") : t("cal.createLink")}
              </button>
              {feed && (
                <button type="button" className="btn" disabled={busy} onClick={revoke} style={{ ...btn, background: "#FDEBEC", color: "#B23A47" }}>
                  {t("cal.turnOff")}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
