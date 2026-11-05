"use client";

import { useEffect } from "react";
import { useLanguage } from "@/lib/i18n-context";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t } = useLanguage();
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div className="rise-in" style={{ maxWidth: 440, width: "100%", textAlign: "center", background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-xl)", padding: "36px 28px", boxShadow: "var(--shadow-frame)" }}>
        <div style={{ fontSize: 40 }}>⚠️</div>
        <h1 style={{ fontSize: 22, fontWeight: 600, marginTop: 12 }}>{t("err.title")}</h1>
        <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.6 }}>
          {t("err.body")}
        </p>
        <button
          className="btn btn-primary"
          onClick={reset}
          style={{ marginTop: 22 }}
        >
          {t("err.retry")}
        </button>
      </div>
    </div>
  );
}
