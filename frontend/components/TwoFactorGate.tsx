"use client";

import { useState } from "react";
import { authApi, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

/**
 * The platform admin's pages wait until two-step sign-in is on (the server
 * refuses them before that): scan the QR code in an authenticator app and
 * type the code it shows.
 */
export default function TwoFactorGate() {
  const { t } = useLanguage();
  const { refreshMe, logout } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      await authApi.confirmTwoFactor(code.trim());
      await refreshMe();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 28, maxWidth: 440, width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
        <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0 }}>{t("sa2fa.title")}</h1>
        <p style={{ fontSize: 13.5, color: "#4A4E58", lineHeight: 1.6, margin: 0 }}>{t("sa2fa.text")}</p>
        {error && (
          <div role="alert" style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "9px 12px", borderRadius: 9 }}>
            {error}
          </div>
        )}
        {qr ? (
          <form onSubmit={confirm} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12.5, color: "#686B75" }}>{t("settings.scanQr")}</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="2FA QR" width={170} height={170} style={{ alignSelf: "center", border: "1px solid #EAE8E2", borderRadius: 8 }} />
            <input
              className="field-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{ textAlign: "center", letterSpacing: "0.3em" }}
            />
            <button type="submit" className="btn" disabled={busy || code.length < 6} style={{ background: ACCENT, color: "#fff", border: "none", fontWeight: 700, fontSize: 14, padding: 12, borderRadius: 10 }}>
              {t("twofa.confirm")}
            </button>
          </form>
        ) : (
          <button type="button" className="btn" onClick={start} disabled={busy} style={{ background: ACCENT, color: "#fff", border: "none", fontWeight: 700, fontSize: 14, padding: 12, borderRadius: 10 }}>
            {t("settings.enable2fa")}
          </button>
        )}
        <button type="button" onClick={logout} style={{ background: "none", border: "none", color: "#686B75", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
          {t("sa2fa.logout")}
        </button>
      </div>
    </div>
  );
}
