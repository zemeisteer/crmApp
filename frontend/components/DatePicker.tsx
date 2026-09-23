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

const currentYear = new Date().getFullYear();
const YEARS = Array.from({ length: 90 }, (_, i) => currentYear + 5 - i);

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
  const [alignRight, setAlignRight] = useState(false);
  const [viewMode, setViewMode] = useState<"days" | "months" | "years">("days");
  const selected = parseLocalStr(value);
  const [viewDate, setViewDate] = useState(() => selected || new Date());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setAlignRight(rect.left + 300 > window.innerWidth);
    }
  }, [open]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setViewMode("days");
      }
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
    setViewMode("days");
  }

  const displayLabel = selected
    ? selected.toLocaleDateString(lang === "UZ" ? "uz-UZ" : lang === "RU" ? "ru-RU" : "en-US", { day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0, ...style }}>
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setViewMode("days");
        }}
        className="field-input"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, cursor: "pointer", textAlign: "left", width: "100%", minHeight: 44 }}
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
            left: alignRight ? "auto" : 0,
            right: alignRight ? 0 : "auto",
            width: 290,
            maxWidth: "calc(100vw - 32px)",
            zIndex: 110,
            background: "#fff",
            border: "1px solid #EAE8E2",
            borderRadius: 14,
            padding: 14,
            boxShadow: "0 14px 36px rgba(18,19,26,0.14), 0 2px 8px rgba(18,19,26,0.06)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 12 }}>
            <button
              type="button"
              onClick={() => {
                if (viewMode === "days") {
                  setViewDate(new Date(year, month - 1, 1));
                } else if (viewMode === "years") {
                  setViewDate(new Date(year - 10, month, 1));
                }
              }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 5, color: "#4A4E58", borderRadius: 6 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {/* Custom Month Toggle Button */}
              <button
                type="button"
                onClick={() => setViewMode((m) => (m === "months" ? "days" : "months"))}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: `1px solid ${viewMode === "months" ? ACCENT : "#EAE8E2"}`,
                  borderRadius: 8,
                  padding: "5px 10px",
                  background: viewMode === "months" ? "#EEF0FF" : "#F7F6F3",
                  color: viewMode === "months" ? ACCENT : "#181A1F",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s ease",
                }}
              >
                <span>{t(MONTH_KEYS[month])}</span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
              </button>

              {/* Custom Year Toggle Button */}
              <button
                type="button"
                onClick={() => setViewMode((m) => (m === "years" ? "days" : "years"))}
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  border: `1px solid ${viewMode === "years" ? ACCENT : "#EAE8E2"}`,
                  borderRadius: 8,
                  padding: "5px 10px",
                  background: viewMode === "years" ? "#EEF0FF" : "#F7F6F3",
                  color: viewMode === "years" ? ACCENT : "#181A1F",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  transition: "all 0.15s ease",
                }}
              >
                <span>{year}</span>
                <span style={{ fontSize: 9, opacity: 0.7 }}>▾</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (viewMode === "days") {
                  setViewDate(new Date(year, month + 1, 1));
                } else if (viewMode === "years") {
                  setViewDate(new Date(year + 10, month, 1));
                }
              }}
              style={{ background: "none", border: "none", cursor: "pointer", padding: 5, color: "#4A4E58", borderRadius: 6 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          </div>

          {/* VIEW: Months Selector Grid */}
          {viewMode === "months" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "6px 0 10px" }}>
              {MONTH_KEYS.map((mk, idx) => {
                const isCurr = idx === month;
                return (
                  <button
                    key={mk}
                    type="button"
                    onClick={() => {
                      setViewDate(new Date(year, idx, 1));
                      setViewMode("days");
                    }}
                    style={{
                      padding: "10px 4px",
                      borderRadius: 8,
                      border: "none",
                      background: isCurr ? ACCENT : "#F7F6F3",
                      color: isCurr ? "#fff" : "#181A1F",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {t(mk)}
                  </button>
                );
              })}
            </div>
          )}

          {/* VIEW: Years Selector Grid */}
          {viewMode === "years" && (
            <div style={{ maxHeight: 210, overflowY: "auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, padding: "4px 2px 10px" }}>
              {YEARS.map((y) => {
                const isCurr = y === year;
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => {
                      setViewDate(new Date(y, month, 1));
                      setViewMode("days");
                    }}
                    style={{
                      padding: "8px 4px",
                      borderRadius: 8,
                      border: "none",
                      background: isCurr ? ACCENT : "#F7F6F3",
                      color: isCurr ? "#fff" : "#181A1F",
                      fontSize: 12.5,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  >
                    {y}
                  </button>
                );
              })}
            </div>
          )}

          {/* VIEW: Normal Days Calendar */}
          {viewMode === "days" && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
                {WEEKDAY_KEYS.map((wk) => (
                  <div key={wk} style={{ fontSize: 10.5, color: "#8A8D96", textAlign: "center", fontWeight: 700, padding: "4px 0" }}>
                    {t(wk)}
                  </div>
                ))}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
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
                        width: 34,
                        height: 34,
                        borderRadius: 8,
                        border: isToday && !isSelected ? `1.5px solid ${ACCENT}` : "none",
                        background: isSelected ? ACCENT : "transparent",
                        color: isSelected ? "#fff" : "#181A1F",
                        fontSize: 12.5,
                        fontWeight: isSelected ? 800 : 600,
                        cursor: "pointer",
                        transition: "all 0.12s ease",
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
              setViewMode("days");
            }}
            style={{
              marginTop: 10,
              width: "100%",
              background: "#F2F1EC",
              border: "none",
              borderRadius: 8,
              padding: "8px 0",
              fontSize: 12,
              fontWeight: 700,
              color: "#4A4E58",
              cursor: "pointer",
            }}
          >
            {t("common.clear")}
          </button>
        </div>
      )}
    </div>
  );
}
