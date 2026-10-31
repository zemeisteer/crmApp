"use client";

import type { ReactNode } from "react";
import CountUp from "./CountUp";

/** A small colored chip next to a number: +12%, -5 (green for good, red for bad). */
export function KpiChip({ children, tone = "success" }: { children: ReactNode; tone?: "success" | "danger" | "warning" | "neutral" }) {
  const colors = {
    success: { background: "var(--success)", color: "#fff" },
    danger: { background: "var(--danger)", color: "#fff" },
    warning: { background: "var(--warning)", color: "#fff" },
    neutral: { background: "var(--surface-sunken)", color: "var(--text-soft)" },
  }[tone];
  return <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: "var(--radius-pill)", lineHeight: 1.4, whiteSpace: "nowrap", ...colors }}>{children}</span>;
}

/**
 * A KPI: a muted label, a large number (counting up from zero) and an
 * optional chip. `format` renders the number (money, percent); `tone` colors
 * the number for a value that needs attention.
 */
export default function Stat({
  label,
  value,
  format,
  chip,
  tone,
  index,
  testId,
}: {
  label: ReactNode;
  value: number | string | null | undefined;
  format?: (n: number) => string;
  chip?: ReactNode;
  tone?: "danger" | "success";
  index?: number;
  testId?: string;
}) {
  return (
    <div className={index !== undefined ? "rise-in" : undefined} style={index !== undefined ? ({ "--i": index } as React.CSSProperties) : undefined} data-testid={testId}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", fontWeight: 500 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
        <b style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.15, color: tone ? `var(--${tone})` : "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {typeof value === "number" ? <CountUp value={value} format={format} /> : value ?? "—"}
        </b>
        {chip}
      </div>
    </div>
  );
}
