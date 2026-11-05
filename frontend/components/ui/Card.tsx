import type { CSSProperties, ElementType, ReactNode } from "react";

type Tone = "surface" | "accent" | "ink" | "lav" | "sky" | "mint" | "peach";

const TONES: Record<Tone, CSSProperties> = {
  surface: { background: "var(--surface)", color: "var(--text)" },
  // The one hero card of a page: the brand accent.
  accent: { background: "var(--accent-gradient)", color: "var(--on-accent)" },
  ink: { background: "var(--ink)", color: "var(--on-ink)" },
  lav: { background: "var(--lav)", color: "var(--text)" },
  sky: { background: "var(--sky)", color: "var(--text)" },
  mint: { background: "var(--mint)", color: "var(--text)" },
  peach: { background: "var(--peach)", color: "var(--text)" },
};

/**
 * A rounded card of the design system. `tone` picks the fill (white, the
 * orange hero, ink, or a pastel); `index` staggers its entrance (rise-in) and
 * `lift` makes it rise on hover (dashboard widgets only, never on cards that
 * hold selects or date pickers).
 */
export default function Card({
  children,
  tone = "surface",
  padding = 20,
  index,
  lift,
  as: Tag = "section",
  className = "",
  style,
  ...rest
}: {
  children: ReactNode;
  tone?: Tone;
  padding?: number | string;
  index?: number;
  lift?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
} & Record<string, unknown>) {
  const classes = ["ui-card", index !== undefined ? "rise-in" : "", lift ? "card-lift" : "", className].filter(Boolean).join(" ");
  return (
    <Tag
      className={classes}
      style={{
        borderRadius: "var(--radius-lg)",
        border: tone === "surface" ? "1px solid var(--card-border)" : "none",
        padding,
        position: "relative",
        minWidth: 0,
        ...(index !== undefined ? ({ "--i": index } as CSSProperties) : {}),
        ...TONES[tone],
        ...style,
      }}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** A card's title row: title, optional subtitle, and something on the right (a select, a link). */
export function CardHeader({ title, subtitle, action, id }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div style={{ minWidth: 0 }}>
        <h3 id={id} style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: "-0.01em", margin: 0 }}>{title}</h3>
        {subtitle && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>{subtitle}</div>}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
