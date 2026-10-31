"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

export default function NotFound() {
  const { t } = useLanguage();
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)" }}>
      <div style={{ maxWidth: 420, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32 }}>
        <div style={{ fontSize: 40, fontWeight: 800, fontFamily: "var(--font-display)", color: ACCENT }}>404</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginTop: 8 }}>{t("nf.title")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 8 }}>{t("nf.body")}</p>
        <Link
          href="/dashboard"
          style={{ display: "inline-block", marginTop: 20, background: ACCENT, color: "var(--on-ink)", fontSize: 13.5, fontWeight: 700, padding: "10px 20px", borderRadius: "var(--radius-sm)" }}
        >
          {t("nf.home")}
        </Link>
      </div>
    </div>
  );
}
