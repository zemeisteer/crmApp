"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";
import type { TranslationKey } from "@/lib/i18n";

const ACCENT = "#4F46E5";
const MONTH_KEYS: TranslationKey[] = [
  "month.jan", "month.feb", "month.mar", "month.apr", "month.may", "month.jun",
  "month.jul", "month.aug", "month.sep", "month.oct", "month.nov", "month.dec",
];
const WEEKDAY_KEYS: TranslationKey[] = [
  "weekday.short.monday", "weekday.short.tuesday", "weekday.short.wednesday", "weekday.short.thursday",
  "weekday.short.friday", "weekday.short.saturday", "weekday.short.sunday",
];

function toLocalStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalStr(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export default function DatePicker({
  value,
  onChange,
  placeholder,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  const { t, lang } = useLanguage();
  const effectivePlaceholder = placeholder ?? t("picker.selectDate");
  const [open, setOpen] = useState(false);
  const selected = parseLocalStr(value);
  const [viewDate, setViewDate] = useState(() => selected || new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (selected) setViewDate(selected);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array.from({ length: startOffset }, (): number | null => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const today = toLocalStr(new Date());

  function pick(day: number) {
    const d = new Date(year, month, day);
    onChange(toLocalStr(d));
    setOpen(false);
  }

  const displayLabel = selected
    ? selected.toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" })
    : "";

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
        <div style={{ marginTop: 6, background: "#fff", border: "1px solid #EAE8E2", borderRadius: 12, padding: 14, boxShadow: "0 8px 24px rgba(18,19,26,0.1)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button type="button" onClick={() => setViewDate(new Date(year, month - 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#4A4E58" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t(MONTH_KEYS[month])} {year}</span>
            <button type="button" onClick={() => setViewDate(new Date(year, month + 1, 1))} style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "#4A4E58" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {WEEKDAY_KEYS.map((wk) => (
              <div key={wk} style={{ fontSize: 10.5, color: "#8A8D96", textAlign: "center", fontWeight: 700, padding: "4px 0" }}>{t(wk)}</div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={i} />;
              const cellStr = toLocalStr(new Date(year, month, day));
              const isSelected = cellStr === value;
              const isToday = cellStr === today;
              return (
                <button
                  type="button"
                  key={i}
                  onClick={() => pick(day)}
                  style={{
                    width: 30, height: 30, borderRadius: 8, border: isToday && !isSelected ? `1px solid ${ACCENT}` : "none",
                    background: isSelected ? ACCENT : "transparent", color: isSelected ? "#fff" : "#181A1F",
                    fontSize: 12.5, fontWeight: isSelected ? 700 : 500, cursor: "pointer",
                  }}
                >
                  {day}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => { onChange(""); setOpen(false); }}
            style={{ marginTop: 10, width: "100%", background: "#F2F1EC", border: "none", borderRadius: 8, padding: "7px 0", fontSize: 12, fontWeight: 600, color: "#4A4E58", cursor: "pointer" }}
          >
            {t("common.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
