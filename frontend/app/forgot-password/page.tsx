"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

export default function ForgotPasswordPage() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.forgotPassword(email);
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)" }}>
      <form onSubmit={onSubmit} style={{ width: 380, background: "var(--surface)", borderRadius: "var(--radius-lg)", padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t("forgotPw.title")}</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
            {t("forgotPw.subtitle")}
          </p>
        </div>

        {error && (
          <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)" }}>{error}</div>
        )}
        {message && (
          <div style={{ background: "var(--success-soft)", color: "var(--success)", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: "var(--radius-sm)", lineHeight: 1.5 }}>
            {message}
          </div>
        )}

        {!message && (
          <>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-soft)", marginBottom: 6 }}>{t("auth.email")}</div>
              <input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="azizbek@bilimdon.uz" />
            </div>
            <button
              className="btn"
              type="submit"
              disabled={loading}
              style={{ background: ACCENT, color: "var(--on-ink)", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: "var(--radius-sm)" }}
            >
              {loading ? t("forgotPw.sending") : t("forgotPw.sendLink")}
            </button>
          </>
        )}

        <Link href="/login" style={{ textAlign: "center", fontSize: 13, color: ACCENT, fontWeight: 600 }}>
          {t("forgotPw.backToLogin")}
        </Link>
      </form>
    </div>
  );
}
