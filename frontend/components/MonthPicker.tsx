"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
const MONTH_KEYS: TranslationKey[] = [
  "month.jan", "month.feb", "month.mar", "month.apr", "month.may", "month.jun",
  "month.jul", "month.aug", "month.sep", "month.oct", "month.nov", "month.dec",
];
const MONTH_SHORT_KEYS: TranslationKey[] = [
  "month.short.jan", "month.short.feb", "month.short.mar", "month.short.apr", "month.short.may", "month.short.jun",
  "month.short.jul", "month.short.aug", "month.short.sep", "month.short.oct", "month.short.nov", "month.short.dec",
];

export default function MonthPicker({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string; // "YYYY-MM"
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.selectMonth");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [y, m] = value ? value.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const [viewYear, setViewYear] = useState(y || new Date().getFullYear());

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const displayLabel = value ? `${t(MONTH_KEYS[(m || 1) - 1])} ${y}` : "";

  function pick(monthIndex: number) {
    onChange(`${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: "relative", ...style }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="field-input"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left", width: "100%" }}
      >
        <span style={{ color: displayLabel ? "#181A1F" : "#8A8D96" }}>{displayLabel || effectivePlaceholder}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A8D96" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 250,
            zIndex: 50,
            background: "#fff",
            border: "1px solid #EAE8E2",
            borderRadius: 14,
            padding: 14,
            boxShadow: "0 12px 32px rgba(18,19,26,0.14)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button type="button" onClick={() => setViewYear((v) => v - 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#4A4E58" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{viewYear}</span>
            <button type="button" onClick={() => setViewYear((v) => v + 1)} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#4A4E58" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
            {MONTH_SHORT_KEYS.map((labelKey, i) => {
              const isSelected = viewYear === y && i + 1 === m;
              return (
                <button
                  type="button"
                  key={labelKey}
                  onClick={() => pick(i)}
                  style={{
                    padding: "8px 4px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12,
                    fontWeight: isSelected ? 700 : 500,
                    background: isSelected ? ACCENT : "#F7F6F3",
                    color: isSelected ? "#fff" : "#181A1F",
                  }}
                >
                  {t(labelKey)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
