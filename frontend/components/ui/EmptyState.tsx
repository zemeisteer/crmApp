import type { ReactNode } from "react";

/** Nothing to show yet: an icon, a sentence, and optionally the action that fills it. */
export default function EmptyState({ icon = "✦", title, text, action, compact }: { icon?: ReactNode; title?: ReactNode; text?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div role="status" style={{ display: "grid", justifyItems: "center", gap: 8, textAlign: "center", padding: compact ? "18px 12px" : "36px 16px", color: "var(--text-muted)" }}>
      <div aria-hidden="true" style={{ width: compact ? 38 : 48, height: compact ? 38 : 48, borderRadius: "var(--radius-pill)", background: "var(--surface-muted)", display: "grid", placeItems: "center", fontSize: compact ? 16 : 20, color: "var(--text-soft)" }}>
        {icon}
      </div>
      {title && <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)" }}>{title}</div>}
      {text && <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.55 }}>{text}</div>}
      {action && <div style={{ marginTop: 6 }}>{action}</div>}
    </div>
  );
}
