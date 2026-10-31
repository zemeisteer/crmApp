"use client";

import { useLanguage } from "@/lib/i18n-context";
import { fill, pageCount, pageRange } from "@/lib/list-paging";

const ACCENT = "var(--primary)";

/**
 * Page controls for a list the server pages: "21–25 of 25", the current
 * page (announced to screen readers when it changes) and previous / next.
 * `label` names the list ("Student list pages"); `shown` is the number of
 * rows on the current page.
 */
export default function ListPager({
  label,
  page,
  pageSize,
  total,
  shown,
  busy = false,
  onChange,
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  shown: number;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  const { t } = useLanguage();
  if (total <= 0) return null;
  const pages = pageCount(total, pageSize);
  const { from, to } = pageRange(page, pageSize, total, shown);
  const btn = (disabled: boolean): React.CSSProperties => ({
    background: disabled ? "var(--surface-muted)" : "var(--surface-muted)",
    color: disabled ? "var(--text-faint)" : "var(--text)",
    border: "none",
    fontSize: 12.5,
    fontWeight: 700,
    padding: "8px 12px",
    borderRadius: "var(--radius-xs)",
    cursor: disabled ? "default" : "pointer",
    whiteSpace: "nowrap",
  });
  return (
    <nav
      aria-label={label}
      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 16px", borderTop: "1px solid var(--border)" }}
    >
      <div role="status" aria-live="polite" style={{ fontSize: 12.5, color: "var(--text-muted)", minWidth: 0 }}>
        <span data-testid="pager-range" style={{ fontWeight: 700, color: "var(--text)" }}>{fill(t("pager.range"), { from, to, total })}</span>
        {pages > 1 && (
          <>
            {" · "}
            <span aria-current="page">{fill(t("pager.pageOf"), { page, count: pages })}</span>
          </>
        )}
      </div>
      {pages > 1 && (
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className="btn"
            aria-label={t("pager.prevPage")}
            disabled={busy || page <= 1}
            onClick={() => onChange(page - 1)}
            style={btn(busy || page <= 1)}
          >
            ‹ {t("pager.prev")}
          </button>
          <button
            type="button"
            className="btn"
            aria-label={t("pager.nextPage")}
            disabled={busy || page >= pages}
            onClick={() => onChange(page + 1)}
            style={{ ...btn(busy || page >= pages), ...(busy || page >= pages ? {} : { background: ACCENT, color: "var(--on-ink)" }) }}
          >
            {t("pager.next")} ›
          </button>
        </div>
      )}
    </nav>
  );
}
