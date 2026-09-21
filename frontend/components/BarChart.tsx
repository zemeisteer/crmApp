"use client";

// Minimal, dependency-free bar chart. No charting library is installed in
// this project, so every page that needs a simple chart (payments, exams,
// reports, AI insights) renders one of these instead of pulling in recharts
// just for a handful of bars.

import { useState } from "react";

export interface BarDatum {
  label: string;
  value: number;
}

export default function BarChart({
  data,
  color = "#4F46E5",
  height = 160,
  formatValue,
}: {
  data: BarDatum[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  const selectedItem = selectedIdx !== null ? data[selectedIdx] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      {selectedItem && (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#EEF0FF",
              color,
              border: "1px solid rgba(79, 70, 229, 0.25)",
              borderRadius: 8,
              padding: "3px 9px",
              fontSize: 11.5,
              fontWeight: 700,
            }}
          >
            <span>{selectedItem.label}: <strong>{formatValue ? formatValue(selectedItem.value) : selectedItem.value}</strong></span>
            <button
              type="button"
              onClick={() => setSelectedIdx(null)}
              style={{ background: "none", border: "none", color, cursor: "pointer", fontSize: 12, fontWeight: 800, padding: 0 }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height, width: "100%", overflowX: "auto", position: "relative" }}>
        {data.length === 0 ? (
          <div style={{ color: "#8A8D96", fontSize: 13, margin: "auto" }}>Ma&apos;lumot yo&apos;q</div>
        ) : (
          data.map((d, i) => {
            const isSelected = selectedIdx === i;
            const isHovered = hoveredIdx === i;
            const barHeight = Math.max(6, (d.value / max) * (height - 46));
            const formatted = formatValue ? formatValue(d.value) : d.value;

            return (
              <div
                key={i}
                onClick={() => setSelectedIdx(isSelected ? null : i)}
                onMouseEnter={() => setHoveredIdx(i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 6,
                  minWidth: 42,
                  flex: "1 0 auto",
                  cursor: "pointer",
                  position: "relative",
                  userSelect: "none",
                }}
              >
                {/* Hover tooltip */}
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
                      zIndex: 20,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                      pointerEvents: "none",
                    }}
                  >
                    {d.label}: {formatted}
                  </div>
                )}
                <div style={{ fontSize: 11, fontWeight: 700, color: isSelected ? color : "#4A4E58" }}>{formatted}</div>
                <div
                  style={{
                    width: 28,
                    height: barHeight,
                    background: isSelected ? color : isHovered ? "#D7D5FA" : "#ECEBFB",
                    borderRadius: 6,
                    transition: "background 0.18s ease, transform 0.18s ease",
                    transform: isHovered || isSelected ? "scaleY(1.03)" : "scaleY(1)",
                    transformOrigin: "bottom",
                  }}
                />
                <div style={{ fontSize: 10.5, color: isSelected ? color : "#8A8D96", fontWeight: isSelected ? 700 : 500, textAlign: "center", maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
