"use client";

import { useLanguage } from "@/lib/i18n-context";

// A load that failed, said on the page (not only in the console), with a
// way to try again.
export default function LoadError({ message, onRetry, compact }: { message: string; onRetry: () => void; compact?: boolean }) {
  const { t } = useLanguage();
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 12,
        background: "#FDEBEC",
        border: "1px solid #F6CDD1",
        color: "#B23A47",
        borderRadius: compact ? 10 : 14,
        padding: compact ? "8px 12px" : "14px 18px",
        fontSize: 13,
        fontWeight: 600,
      }}
    >
      <span>{message}</span>
      <button
        type="button"
        className="btn"
        onClick={onRetry}
        style={{ background: "#fff", color: "#181A1F", border: "1px solid #EAE8E2", fontSize: 12.5, fontWeight: 700, padding: "6px 12px", borderRadius: 8 }}
      >
        {t("adm.retry")}
      </button>
    </div>
  );
}
