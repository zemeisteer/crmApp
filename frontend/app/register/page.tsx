"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { ApiError } from "@/lib/api";

const ACCENT = "#4F46E5";

export default function RegisterPage() {
  const { register } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [centerName, setCenterName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!agreed) {
      setError(
        lang === "UZ"
          ? "Foydalanish shartlari va maxfiylik siyosatiga rozilik bildiring."
          : lang === "RU"
          ? "Пожалуйста, подтвердите согласие с условиями использования."
          : "Please agree to the Terms of Service and Privacy Policy.",
      );
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await register({
        centerName: centerName.trim(),
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (lang === "UZ" ? "Xatolik yuz berdi" : lang === "RU" ? "Произошла ошибка" : "An error occurred"));
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#F7F7F5", position: "relative" }}>
      {/* Top right language switch */}
      <div
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          zIndex: 10,
          display: "flex",
          gap: 4,
          background: "#F2F1EC",
          borderRadius: 9,
          padding: 3,
        }}
      >
        {(["UZ", "RU", "EN"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "6px 10px",
              borderRadius: 7,
              border: "none",
              cursor: "pointer",
              background: lang === l ? "#fff" : "transparent",
              color: lang === l ? "#181A1F" : "#8A8D96",
              boxShadow: lang === l ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
            }}
          >
            {l}
          </button>
        ))}
      </div>

      {/* LEFT: Brand showcase panel */}
      <div
        style={{
          flex: 1.1,
          background: "linear-gradient(135deg, #090514 0%, #161033 50%, #20154D 100%)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "56px 48px",
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
        className="hidden md:flex"
      >
        {/* Glow circles */}
        <div
          style={{
            position: "absolute",
            width: 480,
            height: 480,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99, 102, 241, 0.22), transparent 70%)",
            top: -140,
            right: -100,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            width: 380,
            height: 380,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(168, 85, 247, 0.15), transparent 70%)",
            bottom: -100,
            left: -80,
            zIndex: 1,
            pointerEvents: "none",
          }}
        />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 2 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #6366F1, #4F46E5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(79, 70, 229, 0.35)",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#FFFFFF"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span
            style={{
              fontFamily: "'Manrope', sans-serif",
              fontWeight: 800,
              fontSize: 21,
              color: "#fff",
              letterSpacing: "-0.02em",
            }}
          >
            CRMAPP
          </span>
        </div>

        {/* Value Prop */}
        <div
          style={{
            position: "relative",
            zIndex: 2,
            display: "flex",
            flexDirection: "column",
            gap: 24,
            maxWidth: 460,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 14px",
              borderRadius: 100,
              background: "rgba(255, 255, 255, 0.08)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#C7D2FE",
              fontSize: 12.5,
              fontWeight: 600,
              backdropFilter: "blur(10px)",
              width: "fit-content",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981" }} />
            {t("landing.badge")}
          </div>

          <h1
            style={{
              fontSize: 36,
              lineHeight: 1.25,
              fontWeight: 800,
              color: "#FFFFFF",
              letterSpacing: "-0.025em",
            }}
          >
            {t("register.createCenterTitle")}
          </h1>

          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "#C4C2E0" }}>
            {t("register.createCenterSubtitle")}
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
            {[
              t("register.heroFeature1"),
              t("register.heroFeature2"),
              t("register.heroFeature3"),
            ].map((feature, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 12, color: "#E0E7FF", fontSize: 14 }}>
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "rgba(99, 102, 241, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#A5B4FC" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer info */}
        <div style={{ position: "relative", zIndex: 2, fontSize: 13, color: "#8E8CA8" }}>
          CRMAPP &copy; {new Date().getFullYear()} — {t("auth.allRightsReserved")}
        </div>
      </div>

      {/* RIGHT: Register form */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#FFFFFF",
          padding: "32px 24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", gap: 28 }}>
          {/* Header */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h2
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#111827",
                letterSpacing: "-0.03em",
              }}
            >
              {t("register.createCenterTitle")}
            </h2>
            <p style={{ fontSize: 14.5, color: "#6B7280", lineHeight: 1.5 }}>
              {t("register.createCenterSubtitle")}
            </p>
          </div>

          {error && (
            <div
              style={{
                background: "#FEF2F2",
                border: "1px solid #FEE2E2",
                color: "#B91C1C",
                fontSize: 13.5,
                fontWeight: 600,
                padding: "12px 16px",
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {/* Field: Center Name */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                {t("register.centerName")}
              </label>
              <input
                id="center-name-input"
                className="field-input"
                required
                placeholder="Bilimdon"
                value={centerName}
                onChange={(e) => setCenterName(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Field: Your Full Name */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                {t("register.fullName")}
              </label>
              <input
                id="full-name-input"
                className="field-input"
                required
                placeholder={lang === "UZ" ? "Azizbek Sattorov" : lang === "RU" ? "Азизбек Сатторов" : "Azizbek Sattorov"}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Field: Email */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                {t("auth.email")}
              </label>
              <input
                id="email-input"
                className="field-input"
                type="email"
                required
                placeholder="aziz@ilmmarkazi.uz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Field: Password */}
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#374151",
                  marginBottom: 6,
                }}
              >
                {t("auth.password")}
              </label>
              <input
                id="password-input"
                className="field-input"
                type="password"
                required
                minLength={8}
                placeholder={lang === "UZ" ? "Kamida 8 ta belgi (harf va raqam)" : lang === "RU" ? "Не менее 8 символов" : "At least 8 characters"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: "100%",
                  height: 46,
                  padding: "0 14px",
                  fontSize: 14.5,
                  borderRadius: 10,
                  border: "1.5px solid #E5E7EB",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Terms checkbox */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 4 }}>
              <input
                id="terms-checkbox"
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                style={{ marginTop: 3, cursor: "pointer", width: 16, height: 16, accentColor: ACCENT }}
              />
              <label htmlFor="terms-checkbox" style={{ fontSize: 12.5, color: "#6B7280", lineHeight: 1.4, cursor: "pointer" }}>
                {t("auth.termsAgreement")}
              </label>
            </div>

            {/* Primary CTA */}
            <button
              id="start-for-free-btn"
              className="btn"
              type="submit"
              disabled={loading || !agreed}
              style={{
                width: "100%",
                height: 48,
                background: loading ? "#9CA3AF" : ACCENT,
                color: "#FFFFFF",
                fontSize: 15,
                fontWeight: 700,
                borderRadius: 11,
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(79, 70, 229, 0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                marginTop: 6,
                transition: "all 0.2s ease",
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin" width="18" height="18" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" strokeDasharray="30 60" />
                  </svg>
                  <span>{t("register.preparing")}</span>
                </>
              ) : (
                <>
                  <span>{t("auth.tryFree")}</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <div
            style={{
              paddingTop: 12,
              borderTop: "1px solid #F3F4F6",
              textAlign: "center",
              fontSize: 13.5,
              color: "#6B7280",
            }}
          >
            {t("auth.haveAccount")}{" "}
            <Link
              href="/login"
              id="login-link"
              style={{
                color: ACCENT,
                fontWeight: 700,
                textDecoration: "none",
              }}
            >
              {t("auth.login")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
