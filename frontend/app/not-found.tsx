"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="rise-in" style={{ maxWidth: 440, width: "100%", textAlign: "center", background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-xl)", padding: "36px 28px", boxShadow: "var(--shadow-frame)" }}>
        <div style={{ fontSize: 72, fontWeight: 600, letterSpacing: "-0.05em", lineHeight: 1, fontFamily: "var(--font-display)", color: "var(--accent-strong)" }}>404</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 12 }}>{t("nf.title")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 8 }}>{t("nf.body")}</p>
        <Link
          href="/dashboard"
          className="btn-primary" style={{ marginTop: 22 }}
        >
          {t("nf.home")}
        </Link>
      </div>
    </div>
  );
}
