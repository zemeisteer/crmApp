"use client";

// Minimal, dependency-free bar chart. No charting library is installed in
// this project, so every page that needs a simple chart (payments, exams,
// reports, AI insights) renders one of these instead of pulling in recharts
// just for a handful of bars.

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
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height, width: "100%", overflowX: "auto" }}>
      {data.length === 0 ? (
        <div style={{ color: "#8A8D96", fontSize: 13, margin: "auto" }}>Ma&apos;lumot yo&apos;q</div>
      ) : (
        data.map((d, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 42, flex: "1 0 auto" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#4A4E58" }}>{formatValue ? formatValue(d.value) : d.value}</div>
            <div
              style={{
                width: 28,
                height: Math.max(4, (d.value / max) * (height - 46)),
                background: color,
                borderRadius: 6,
              }}
            />
            <div style={{ fontSize: 10.5, color: "#8A8D96", textAlign: "center", maxWidth: 56, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {d.label}
            </div>
          </div>
        ))
      )}
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
