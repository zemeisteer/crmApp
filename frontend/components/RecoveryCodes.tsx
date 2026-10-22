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
      <div style={{ fontSize: 12.5, color: "#4A4E58", lineHeight: 1.55 }}>{t("twofa.recoveryText")}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 12, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6, background: "#F7F6F2", borderRadius: 10, fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={copy} style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          {copied ? t("twofa.copied") : t("twofa.copy")}
        </button>
        <button type="button" className="btn" onClick={onDone} style={{ background: "#4F46E5", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, padding: "8px 14px", borderRadius: 8 }}>
          {t("twofa.saved")}
        </button>
      </div>
    </div>
  );
}
