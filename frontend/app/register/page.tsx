"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";
import { ApiError, TenantCategory } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";

const CATEGORY_OPTIONS: TenantCategory[] = ["TIL_MARKAZI", "MATEMATIKA", "IT", "BOSHQA"];
const CATEGORY_LABEL_KEYS: Record<TenantCategory, TranslationKey> = {
  TIL_MARKAZI: "category.tilMarkazi",
  MATEMATIKA: "category.matematika",
  IT: "category.it",
  BOSHQA: "category.boshqa",
};

export default function RegisterPage() {
  const { register } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const [centerName, setCenterName] = useState("");
  const [subdomain, setSubdomain] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [category, setCategory] = useState<TenantCategory>("TIL_MARKAZI");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await register({ centerName, subdomain, fullName, email, password, category });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Xatolik yuz berdi");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#F7F7F5", position: "relative" }}>
      <div style={{ position: "absolute", top: 20, right: 20, zIndex: 10, display: "flex", gap: 4, background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
        {(["UZ", "RU", "EN"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            style={{
              fontSize: 11, fontWeight: 700, padding: "6px 10px", borderRadius: 7, border: "none", cursor: "pointer",
              background: lang === l ? "#fff" : "transparent",
              color: lang === l ? "#181A1F" : "#8A8D96",
              boxShadow: lang === l ? "0 1px 3px rgba(18,19,26,0.08)" : "none",
            }}
          >
            {l}
          </button>
        ))}
      </div>
      {/* LEFT: brand panel */}
      <div
        style={{
          flex: 1,
          background: "linear-gradient(135deg,#0F0B29,#1B1440)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 48,
          boxSizing: "border-box",
          position: "relative",
          overflow: "hidden",
        }}
        className="hidden md:flex"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 2 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: ACCENT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 19, color: "#fff", letterSpacing: "-0.02em" }}>
            TalimCRM
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 18, maxWidth: 420 }}>
          <h1 style={{ fontSize: 34, lineHeight: 1.2, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>
            {t("register.heroTitle")}
          </h1>
          <p style={{ fontSize: 15, lineHeight: 1.65, color: "#B7B0E8" }}>
            {t("register.heroSubtitle")}
          </p>
        </div>

        <div style={{ position: "relative", zIndex: 2, fontSize: 12.5, color: "#71737C" }}>
          {t("landing.footer")}
        </div>
        <div
          style={{
            position: "absolute",
            width: 420,
            height: 420,
            borderRadius: "50%",
            background: "radial-gradient(circle,rgba(139,124,246,0.25),transparent 70%)",
            top: -120,
            right: -120,
            zIndex: 1,
          }}
        />
      </div>

      {/* RIGHT: register form */}
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "#fff" }}>
        <form onSubmit={onSubmit} style={{ width: 400, display: "flex", flexDirection: "column", gap: 22, padding: "24px" }}>
          <div style={{ display: "flex", background: "#F2F1EC", borderRadius: 11, padding: 4 }}>
            <Link
              href="/login"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 13.5,
                fontWeight: 700,
                padding: 9,
                borderRadius: 8,
                color: "#8A8D96",
              }}
            >
              {t("auth.login")}
            </Link>
            <div
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 13.5,
                fontWeight: 700,
                padding: 9,
                borderRadius: 8,
                background: "#fff",
                color: "#181A1F",
                boxShadow: "0 1px 3px rgba(18,19,26,0.08)",
              }}
            >
              {t("auth.register")}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em" }}>{t("register.formTitle")}</h2>
            <p style={{ fontSize: 13.5, color: "#8A8D96" }}>{t("register.formSubtitle")}</p>
          </div>

          {error && (
            <div style={{ background: "#FDEBEC", color: "#B23A47", fontSize: 13, fontWeight: 600, padding: "10px 14px", borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("register.centerName")}</div>
              <input
                className="field-input"
                required
                placeholder="Bilimdon"
                value={centerName}
                onChange={(e) => setCenterName(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("register.centerAddress")}</div>
              <div style={{ display: "flex", alignItems: "center", border: "1px solid #EAE8E2", borderRadius: 10, overflow: "hidden" }}>
                <input
                  className="field-input"
                  style={{ border: "none", borderRadius: 0 }}
                  required
                  pattern="[a-z0-9\-]{3,30}"
                  title="Faqat kichik lotin harflari, raqam va - (3-30 belgi)"
                  placeholder="bilimdon"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.toLowerCase())}
                />
                <span style={{ padding: "12px 14px", background: "#F7F7F5", color: "#8A8D96", fontSize: 13.5, borderLeft: "1px solid #EAE8E2", whiteSpace: "nowrap" }}>
                  .talimcrm.uz
                </span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("register.fullName")}</div>
              <input
                className="field-input"
                required
                placeholder="Azizbek Sattorov"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("auth.email")}</div>
              <input
                className="field-input"
                type="email"
                required
                placeholder="azizbek@bilimdon.uz"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("register.direction")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => setCategory(c)}
                    style={{
                      textAlign: "left", fontSize: 13, fontWeight: 600, padding: "10px 12px", borderRadius: 9, cursor: "pointer",
                      border: category === c ? `1.5px solid ${ACCENT}` : "1px solid #EAE8E2",
                      background: category === c ? "#EEF0FF" : "#fff",
                      color: category === c ? ACCENT : "#4A4E58",
                    }}
                  >
                    {t(CATEGORY_LABEL_KEYS[c])}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "#4A4E58", marginBottom: 6 }}>{t("auth.password")}</div>
              <input
                className="field-input"
                type="password"
                required
                minLength={6}
                placeholder="Kamida 6 ta belgi"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            className="btn"
            type="submit"
            disabled={loading}
            style={{ background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 700, padding: 13, borderRadius: 10 }}
          >
            {loading ? t("auth.loggingIn") : t("landing.getStarted")}
          </button>

          <p style={{ textAlign: "center", fontSize: 13, color: "#8A8D96" }}>
            {t("auth.haveAccount")}{" "}
            <Link href="/login" style={{ color: ACCENT, fontWeight: 700 }}>
              {t("auth.login")}
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
