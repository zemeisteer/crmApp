"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

const FEATURES = [
  {
    titleKey: "landing.feature1Title",
    descKey: "landing.feature1Desc",
    icon: (
      <path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
    ),
  },
  {
    titleKey: "landing.feature2Title",
    descKey: "landing.feature2Desc",
    icon: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M9 18h6" /></>,
  },
  {
    titleKey: "landing.feature3Title",
    descKey: "landing.feature3Desc",
    icon: <><path d="M3 3v18h18" /><path d="M7 15l4-5 3 3 5-7" /></>,
  },
  {
    titleKey: "landing.feature4Title",
    descKey: "landing.feature4Desc",
    icon: <><path d="M12 2a7 7 0 0 0-4 12.75c.6.47 1 1.2 1 2.02V17h6v-.23c0-.82.4-1.55 1-2.02A7 7 0 0 0 12 2Z" /></>,
  },
  {
    titleKey: "landing.feature5Title",
    descKey: "landing.feature5Desc",
    icon: <><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" /></>,
  },
  {
    titleKey: "landing.feature6Title",
    descKey: "landing.feature6Desc",
    icon: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  },
] as const;

function LandingPage() {
  const { t, lang, setLang } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", background: "#F7F7F5" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 48px", maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, background: ACCENT, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 10 12 5 2 10l10 5 10-5Z" />
              <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
            </svg>
          </div>
          <span style={{ fontFamily: "'Manrope', sans-serif", fontWeight: 800, fontSize: 19, letterSpacing: "-0.02em" }}>TalimCRM</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ display: "flex", gap: 4, background: "#F2F1EC", borderRadius: 9, padding: 3 }}>
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
          <div style={{ display: "flex", gap: 10 }}>
            <Link href="/login" className="btn" style={{ display: "inline-block", background: "transparent", color: "#181A1F", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
              {t("auth.login")}
            </Link>
            <Link href="/register" className="btn" style={{ display: "inline-block", background: ACCENT, color: "#fff", fontSize: 13.5, fontWeight: 700, padding: "10px 18px", borderRadius: 9 }}>
              {t("landing.getStarted")}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section
        style={{
          maxWidth: 1200, margin: "0 auto", padding: "64px 48px 80px", display: "flex", alignItems: "center", gap: 48, flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 420px", display: "flex", flexDirection: "column", gap: 22 }}>
          <span style={{ alignSelf: "flex-start", fontSize: 12, fontWeight: 700, color: ACCENT, background: "#EEF0FF", padding: "5px 12px", borderRadius: 100 }}>
            {t("landing.badge")}
          </span>
          <h1 style={{ fontSize: 46, lineHeight: 1.15, fontWeight: 800, letterSpacing: "-0.02em" }}>
            {t("landing.heroTitlePrefix")} <span style={{ color: ACCENT }}>{t("landing.heroTitleAccent")}</span> {t("landing.heroTitleSuffix")}
          </h1>
          <p style={{ fontSize: 16.5, lineHeight: 1.65, color: "#4A4E58", maxWidth: 480 }}>
            {t("landing.heroDesc")}
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/register" className="btn" style={{ display: "inline-block", background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 700, padding: "13px 24px", borderRadius: 10 }}>
              {t("auth.tryFree")}
            </Link>
            <Link href="/login" className="btn" style={{ display: "inline-block", background: "#fff", border: "1px solid #EAE8E2", color: "#181A1F", fontSize: 14.5, fontWeight: 700, padding: "13px 24px", borderRadius: 10 }}>
              {t("landing.haveAccount")}
            </Link>
          </div>
          <div style={{ fontSize: 12.5, color: "#8A8D96" }}>{t("landing.noCard")}</div>
        </div>

        <div style={{ flex: "1 1 380px", position: "relative", minWidth: 320 }}>
          <div
            style={{
              background: "linear-gradient(135deg,#0F0B29,#1B1440)", borderRadius: 22, padding: 32, position: "relative", overflow: "hidden", minHeight: 340,
              boxShadow: "0 24px 60px rgba(15,11,41,0.25)",
            }}
          >
            <div
              style={{
                position: "absolute", width: 320, height: 320, borderRadius: "50%",
                background: "radial-gradient(circle,rgba(139,124,246,0.3),transparent 70%)", top: -100, right: -100,
              }}
            />
            <div style={{ position: "relative", zIndex: 2, display: "flex", flexDirection: "column", gap: 16 }}>
              {[
                { label: t("landing.statRevenue"), value: "12 450 000 so'm", color: "#1FA463" },
                { label: t("landing.statActiveStudents"), value: "184", color: "#4F46E5" },
                { label: t("landing.statAttendanceToday"), value: "92%", color: "#EA7A3A" },
              ].map((s) => (
                <div key={s.label} style={{ background: "rgba(255,255,255,0.06)", borderRadius: 14, padding: 18, border: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: 12, color: "#B7B0E8" }}>{s.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginTop: 4, fontFamily: "'Manrope', sans-serif" }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 48px 80px" }}>
        <h2 style={{ fontSize: 26, fontWeight: 800, textAlign: "center", letterSpacing: "-0.02em", marginBottom: 40 }}>
          {t("landing.featuresTitle")}
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {FEATURES.map((f) => (
            <div key={f.titleKey} style={{ background: "#fff", border: "1px solid #EAE8E2", borderRadius: 16, padding: 24 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "#EEF0FF", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {f.icon}
                </svg>
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 700, fontFamily: "'Manrope', sans-serif", marginBottom: 8 }}>{t(f.titleKey)}</div>
              <div style={{ fontSize: 13.5, color: "#8A8D96", lineHeight: 1.6 }}>{t(f.descKey)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section style={{ maxWidth: 1200, margin: "0 auto", padding: "0 48px 80px" }}>
        <div
          style={{
            background: "linear-gradient(135deg,#0F0B29,#1B1440)", borderRadius: 24, padding: "56px 40px", textAlign: "center",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
          }}
        >
          <h2 style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{t("landing.ctaTitle")}</h2>
          <p style={{ fontSize: 14.5, color: "#B7B0E8", maxWidth: 420 }}>
            {t("landing.ctaDesc")}
          </p>
          <Link href="/register" className="btn" style={{ display: "inline-block", background: ACCENT, color: "#fff", fontSize: 14.5, fontWeight: 700, padding: "13px 28px", borderRadius: 10 }}>
            {t("landing.getStarted")}
          </Link>
        </div>
      </section>

      <footer style={{ textAlign: "center", padding: "24px 48px", fontSize: 12.5, color: "#8A8D96" }}>
        {t("landing.footer")}
      </footer>
    </div>
  );
}

export default function Home() {
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F7F7F5" }}>
        <div style={{ color: "#8A8D96", fontSize: 14 }}>{t("common.loading")}</div>
      </div>
    );
  }

  return <LandingPage />;
}
