"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "#4F46E5";

export default function TermsPage() {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", background: "#F7F7F5" }}>
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <Link href="/" style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>
          {t("legal.backToHome")}
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 20, fontFamily: "'Manrope', sans-serif" }}>{t("terms.title")}</h1>
        <p style={{ fontSize: 13, color: "#8A8D96", marginTop: 6 }}>{t("legal.lastUpdated")}</p>

        <div style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 20, fontSize: 14.5, lineHeight: 1.7, color: "#181A1F" }}>
          <section>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t("terms.s1Title")}</h2>
            <p>{t("terms.s1Body")}</p>
          </section>
          <section>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t("terms.s2Title")}</h2>
            <p>{t("terms.s2Body")}</p>
          </section>
          <section>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t("terms.s3Title")}</h2>
            <p>{t("terms.s3Body")}</p>
          </section>
          <section>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t("terms.s4Title")}</h2>
            <p>{t("terms.s4Body")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
