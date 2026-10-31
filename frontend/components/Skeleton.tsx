"use client";

import { useLanguage } from "@/lib/i18n-context";

// Grey placeholder shapes in the layout of what is loading, so the page does
// not jump when the data arrives. Screen readers hear "Loading...".
function Bar({ width, height = 12 }: { width: number | string; height?: number }) {
  return <div className="skeleton" style={{ width, height }} />;
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  const { t } = useLanguage();
  return (
    <div role="status" aria-busy="true" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", overflow: "hidden" }}>
      <span className="sr-only">{t("common.loading")}</span>
      <div style={{ display: "flex", gap: 24, padding: "14px 20px", borderBottom: "1px solid var(--border)", background: "var(--surface-muted)" }}>
        <Bar width={120} height={10} />
        <Bar width={90} height={10} />
        <Bar width={70} height={10} />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 24, padding: "14px 20px", borderBottom: i < rows - 1 ? "1px solid var(--border)" : undefined }}>
          <div className="skeleton" style={{ width: 32, height: 32, borderRadius: "var(--radius-pill)", flexShrink: 0 }} />
          <Bar width={`${28 + ((i * 7) % 12)}%`} />
          <Bar width="18%" />
          <Bar width="12%" />
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  const { t } = useLanguage();
  const card = { background: "var(--surface)", border: "1px solid var(--card-border)", borderRadius: "var(--radius-lg)", padding: 20, display: "flex", flexDirection: "column" as const, gap: 14 };
  return (
    <div role="status" aria-busy="true" className="dash-grid">
      <span className="sr-only">{t("dashboard.loading")}</span>
      <div className="c3 r2" style={{ ...card, minHeight: 420 }}>
        <Bar width="50%" height={14} />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 70, borderRadius: "var(--radius-md)" }} />
        ))}
      </div>
      <div className="c6" style={{ ...card, height: 300 }}>
        <Bar width={180} height={14} />
        <div className="skeleton" style={{ flex: 1, borderRadius: "var(--radius-md)" }} />
      </div>
      <div className="c3 skeleton" style={{ height: 300, borderRadius: "var(--radius-lg)" }} />
      <div className="c4" style={{ ...card, height: 220 }}>
        <Bar width="60%" height={14} />
        <div className="skeleton" style={{ width: 130, height: 130, borderRadius: "50%", alignSelf: "center" }} />
      </div>
      <div className="c5" style={{ ...card, height: 220 }}>
        <Bar width="55%" height={14} />
        <Bar width="100%" height={8} />
        <Bar width="100%" height={8} />
        <Bar width="100%" height={8} />
      </div>
    </div>
  );
}
