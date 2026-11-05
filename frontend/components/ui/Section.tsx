import type { ReactNode } from "react";

/** A titled block inside a page (settings sections, forms): heading, hint, content. */
export default function Section({ title, hint, actions, children, id }: { title: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 id={id} style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{title}</h2>
          {hint && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
