"use client";

import { useState } from "react";
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import RecoveryCodes from "./RecoveryCodes";

const ACCENT = "var(--primary)";

/**
 * The platform admin's pages wait until two-step sign-in is on (the server
 * refuses them before that): scan the QR code in an authenticator app and
 * type the code it shows.
 */
export default function TwoFactorGate() {
  const { t } = useLanguage();
  const { user, refreshMe, logout } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);

  async function start() {
    setError(null);
    setBusy(true);
    try {
      setQr((await authApi.setupTwoFactor()).qrDataUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // The recovery codes are shown first; the pages open when they are kept.
      setRecovery((await authApi.confirmTwoFactor(code.trim())).recoveryCodes);
      setBusy(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 28, maxWidth: 440, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", margin: 0 }}>{t("sa2fa.title")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-soft)", lineHeight: 1.6, margin: 0 }}>{user?.twoFactorEnabled && !recovery ? t("sa2fa.reloginText") : t("sa2fa.text")}</p>
        {recovery && <RecoveryCodes codes={recovery} onDone={() => void refreshMe()} />}
        {error && (
          <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: "var(--radius-sm)" }}>
            {error}
          </div>
        )}
        {recovery ? null : user?.twoFactorEnabled ? (
          // 2FA is on, but this session did not pass it: sign in again with the code.
          <button type="button" className="btn" onClick={logout} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontWeight: 700, fontSize: 14, padding: 12, borderRadius: "var(--radius-sm)" }}>
            {t("sa2fa.relogin")}
          </button>
        ) : qr ? (
          <form onSubmit={confirm} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{t("settings.scanQr")}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="2FA QR" width={170} height={170} style={{ alignSelf: "center", border: "1px solid var(--border)", borderRadius: "var(--radius-xs)" }} />
            <input
              className="field-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{ textAlign: "center", letterSpacing: "0.3em" }}
            />
            <button type="submit" className="btn" disabled={busy || code.length < 6} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontWeight: 700, fontSize: 14, padding: 12, borderRadius: "var(--radius-sm)" }}>
              {t("twofa.confirm")}
            </button>
          </form>
        ) : (
          <button type="button" className="btn" onClick={start} disabled={busy} style={{ background: ACCENT, color: "var(--on-ink)", border: "none", fontWeight: 700, fontSize: 14, padding: 12, borderRadius: "var(--radius-sm)" }}>
            {t("settings.enable2fa")}
          </button>
        )}
        <button type="button" onClick={logout} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
          {t("sa2fa.logout")}
        </button>
      </div>
    </div>
  );
}
