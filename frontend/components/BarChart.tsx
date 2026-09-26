"use client";

// Minimal, dependency-free bar chart. No charting library is installed in
// this project, so every page that needs a simple chart (payments, exams,
// reports, AI insights) renders one of these instead of pulling in recharts
// just for a handful of bars.

import { useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n-context";

export interface BarDatum {
  label: string;
  value: number;
  isCurrent?: boolean;
  // Longer name for the badge and tooltip (e.g. the full month name).
  title?: string;
}

export default function BarChart({
  data,
  color = "#4F46E5",
  height = 160,
  formatValue,
  defaultActiveIdx,
  unit,
  emptyText,
}: {
  data: BarDatum[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  defaultActiveIdx?: number;
  // Shown after the value, e.g. "so'm" or "belgi".
  unit?: string;
  // Replaces the chart when there is nothing (or only zeros) to show.
  emptyText?: string;
}) {
  const { t } = useLanguage();
  const currentIdx = useMemo(() => {
    const found = data.findIndex((d) => d.isCurrent);
    if (found >= 0) return found;
    if (defaultActiveIdx !== undefined && defaultActiveIdx >= 0 && defaultActiveIdx < data.length) {
      return defaultActiveIdx;
    }
    return data.length > 0 ? 0 : null;
  }, [data, defaultActiveIdx]);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  const activeIdx = selectedIdx !== null ? selectedIdx : currentIdx;
  const selectedItem = activeIdx !== null && activeIdx >= 0 && activeIdx < data.length ? data[activeIdx] : null;
  const isCustomSelected = selectedIdx !== null && selectedIdx !== currentIdx;
  const isEmpty = data.length === 0 || (!!emptyText && data.every((d) => d.value === 0));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      {selectedItem && !isEmpty && (
        <div style={{ display: "flex", justifyContent: "flex-end", minHeight: 28 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#EEF0FF",
              color,
              border: "1px solid rgba(79, 70, 229, 0.25)",
              borderRadius: 8,
              padding: "4px 10px",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span>
              {selectedItem.title ?? selectedItem.label}: <strong>{formatValue ? formatValue(selectedItem.value) : selectedItem.value}</strong>
              {unit && ` ${unit}`}
              {!isCustomSelected && selectedItem.isCurrent && (
                <span style={{ fontSize: 11, opacity: 0.85, marginLeft: 4, fontWeight: 500 }}>
                  ({t("chart.current")})
                </span>
              )}
            </span>
            {isCustomSelected && (
              <button
                type="button"
                onClick={() => setSelectedIdx(currentIdx)}
                style={{
                  background: "none",
                  border: "none",
                  color,
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 800,
                  padding: "0 2px",
                  lineHeight: 1,
                }}
                title={t("common.clear")}
              >
                ✕
              </button>
            )}
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height, width: "100%", overflowX: "auto", position: "relative", paddingBottom: 4 }}>
        {isEmpty ? (
          <div style={{ color: "#8A8D96", fontSize: 13, margin: "auto", textAlign: "center", maxWidth: 320 }}>{emptyText ?? t("chart.noData")}</div>
        ) : (
          data.map((d, i) => {
            const isSelected = activeIdx === i;
            const isHovered = hoveredIdx === i;
            const barHeight = Math.max(6, (d.value / max) * (height - 46));
            const formatted = formatValue ? formatValue(d.value) : d.value;

            return (
              <div
                key={i}
                onClick={() => setSelectedIdx(isSelected && isCustomSelected ? currentIdx : i)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 34,
                  flex: "1 1 0",
                  cursor: "pointer",
                  position: "relative",
                  userSelect: "none",
                }}
              >
                {/* Hover tooltip near mouse/bar */}
                {isHovered && !isSelected && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: barHeight + 28,
                      background: "#181A1F",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "4px 8px",
                      borderRadius: 6,
                      whiteSpace: "nowrap",
                      zIndex: 30,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
                      pointerEvents: "none",
                    }}
                  >
                    {d.title ?? d.label}: {formatted}
                    {unit && ` ${unit}`}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: isSelected ? 800 : 600, color: isSelected ? color : "#4A4E58" }}>
                  {formatted}
                </div>
                <div
                  style={{
                    width: "70%",
                    maxWidth: 40,
                    minWidth: 18,
                    height: barHeight,
                    background: isSelected ? color : isHovered ? `${color}66` : `${color}24`,
                    border: isSelected ? `2px solid ${color}` : "1px solid transparent",
                    borderRadius: 6,
                    transition: "background 0.15s ease, transform 0.15s ease",
                    transform: isHovered || isSelected ? "scaleY(1.04)" : "scaleY(1)",
                    transformOrigin: "bottom",
                  }}
                />
                <div
                  style={{
                    fontSize: 10.5,
                    color: isSelected ? color : "#8A8D96",
                    fontWeight: isSelected ? 700 : 500,
                    textAlign: "center",
                    maxWidth: 56,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {d.label}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function DonutChart({
  value,
  max,
  color = "#4F46E5",
  size = 120,
  label,
}: {
  value: number;
  max: number;
  color?: string;
  size?: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = size / 2 - 10;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - pct);
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#EAE8E2" strokeWidth={10} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={10}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{Math.round(pct * 100)}%</div>
        {label && <div style={{ fontSize: 10, color: "#8A8D96" }}>{label}</div>}
      </div>
    </div>
  );
}
