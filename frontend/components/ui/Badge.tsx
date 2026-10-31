import type { ReactNode } from "react";

export type BadgeTone = "success" | "danger" | "warning" | "info" | "neutral" | "accent" | "primary" | "violet";

const TONE: Record<BadgeTone, { color: string; background: string }> = {
  success: { color: "var(--success)", background: "var(--success-soft)" },
  danger: { color: "var(--danger)", background: "var(--danger-soft)" },
  warning: { color: "var(--warning)", background: "var(--warning-soft)" },
  info: { color: "var(--info)", background: "var(--info-soft)" },
  neutral: { color: "var(--text-muted)", background: "var(--surface-muted)" },
  accent: { color: "var(--accent-strong)", background: "var(--accent-soft)" },
  primary: { color: "var(--primary)", background: "var(--primary-soft)" },
  violet: { color: "var(--violet)", background: "var(--violet-soft)" },
};

/** A status chip: soft fill, strong text, pill shape. */
export default function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: BadgeTone; title?: string }) {
  return (
    <span className="badge" title={title} style={TONE[tone]}>
      {children}
    </span>
  );
}
