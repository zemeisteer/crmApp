"use client";

import { useId, useMemo, useState } from "react";

export interface LinePoint {
  label: string;
  value: number;
  /** Full name for the readout (the month's full name). */
  title?: string;
  isCurrent?: boolean;
}

/**
 * A smooth line with a soft area under it, drawn in from the left once
 * (draw-line). Hover or focus a point to read its value; the current point is
 * marked. Dependency-free, sized by its container.
 */
export default function LineChart({
  data,
  color = "var(--accent)",
  height = 190,
  format = (n) => String(n),
  unit,
  emptyText,
  label,
}: {
  data: LinePoint[];
  color?: string;
  height?: number;
  format?: (n: number) => string;
  unit?: string;
  emptyText?: string;
  label: string;
}) {
  const id = useId().replace(/:/g, "");
  const W = 600;
  const H = height;
  const pad = { t: 14, b: 8 };
  const max = Math.max(1, ...data.map((d) => d.value));
  const pts = useMemo(
    () => data.map((d, i) => [data.length === 1 ? W / 2 : (i * W) / (data.length - 1), pad.t + (1 - d.value / max) * (H - pad.t - pad.b)] as const),
    [data, max, H, pad.t, pad.b],
  );
  const path = pts.reduce((acc, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = pts[i - 1];
    const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, "");
  const currentIdx = Math.max(0, data.findIndex((d) => d.isCurrent));
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? currentIdx;
  const empty = data.length === 0 || data.every((d) => d.value === 0);

  if (empty) {
    return <div style={{ height, display: "grid", placeItems: "center", color: "var(--text-muted)", fontSize: 13 }}>{emptyText}</div>;
  }
  const s = data[shown];
  return (
    <div>
      <div aria-live="polite" style={{ display: "flex", justifyContent: "flex-end", minHeight: 26, marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-soft)", background: "var(--surface-muted)", padding: "4px 12px", borderRadius: "var(--radius-pill)" }}>
          {s.title ?? s.label}: <strong style={{ color: "var(--text)" }}>{format(s.value)}</strong>
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
      <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} style={{ width: "100%", height, display: "block", overflow: "visible" }}>
        <defs>
          <linearGradient id={`lc-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={pad.t + f * (H - pad.t - pad.b)} y2={pad.t + f * (H - pad.t - pad.b)} stroke="var(--border)" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
        ))}
        <path d={`${path} L${W},${H} L0,${H}Z`} fill={`url(#lc-${id})`} className="fade-in" style={{ ["--delay" as string]: "0.5s" }} />
        <path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" pathLength={1} className="draw-line" vectorEffect="non-scaling-stroke" />
        {pts.map(([x], i) => (
          <g key={i}>
            <rect x={x - W / data.length / 2} y={0} width={W / data.length} height={H} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
      </svg>
      {/* The marked point: an HTML dot, so the stretched SVG cannot squash it. */}
      <span
        aria-hidden="true"
        className="fade-in"
        style={{ ["--delay" as string]: "0.6s", position: "absolute", left: `${(pts[shown][0] / W) * 100}%`, top: pts[shown][1], width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%", background: "var(--surface)", border: `3px solid ${color}`, boxSizing: "border-box", pointerEvents: "none" }}
      />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--text-muted)" }}>
        {data.map((d, i) => (
          <span key={i} style={{ fontWeight: i === shown ? 700 : 500, color: i === shown ? "var(--text)" : undefined }}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
