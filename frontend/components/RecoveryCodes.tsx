"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

/**
 * The one-time recovery codes, shown once right after 2FA is confirmed:
 * each signs in once when the phone is lost. The caller moves on when the
 * person says they kept them.
 */
export default function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div role="region" aria-label={t("twofa.recoveryTitle")} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{t("twofa.recoveryTitle")}</div>
      <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.55 }}>{t("twofa.recoveryText")}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, background: "var(--surface-muted)", borderRadius: "var(--radius-sm)", fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={copy} style={{ background: "var(--surface-muted)", color: "var(--text)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-xs)" }}>
          {copied ? t("twofa.copied") : t("twofa.copy")}
        </button>
        <button type="button" className="btn" onClick={onDone} style={{ background: "var(--primary)", color: "var(--on-ink)", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: "var(--radius-xs)" }}>
          {t("twofa.saved")}
        </button>
      </div>
    </div>
  );
}
