"use client";

import { useState } from "react";
import Link from "next/link";
import { authApi, ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

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
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
      <form onSubmit={onSubmit} style={{ width: 380, background: "#fff", borderRadius: 16, padding: 32, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>{t("forgotPw.title")}</h1>
          <p style={{ fontSize: 13, color: "#8A8D96", marginTop: 4 }}>
            {t("forgotPw.subtitle")}
          </p>
        </div>

        {error && (
          <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>{error}</div>
        )}
        {message && (
          <div style={{ background: "#E9F8EF", color: "#1FA463", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10, lineHeight: 1.5 }}>
            {message}
          </div>
        )}

        {!message && (
          <>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("auth.email")}</div>
              <input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="azizbek@bilimdon.uz" />
            </div>
            <button
              className="btn"
              type="submit"
              disabled={loading}
              style={{ background: ACCENT, color: "#fff", fontSize: 14, fontWeight: 700, padding: 12, borderRadius: 10 }}
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
