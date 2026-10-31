"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/i18n-context";

const ACCENT = "var(--primary)";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-muted)" }}>
      <div style={{ maxWidth: 420, textAlign: "center", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 32 }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 18, fontWeight: 800, marginTop: 12 }}>{t("err.title")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }}>
          {t("err.body")}
        </p>
        <button
          className="btn"
          onClick={reset}
          style={{ marginTop: 20, background: ACCENT, color: "var(--on-ink)", fontSize: 13.5, fontWeight: 700, padding: "10px 20px", borderRadius: "var(--radius-sm)", border: "none" }}
        >
          {t("err.retry")}
        </button>
      </div>
    </div>
  );
}
