"use client";

const ACCENT = "#4F46E5";

export function usePagedSlice<T>(items: T[], page: number, pageSize = 20): T[] {
  const start = (page - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

export default function Pagination({
  page,
  total,
  pageSize = 20,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;

  const pages: number[] = [];
  for (let p = Math.max(1, page - 2); p <= Math.min(pageCount, page + 2); p++) pages.push(p);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "16px 0" }}>
      <button
        className="btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
      >
        ‹
      </button>
      {pages[0] > 1 && <span style={{ color: "#8A8D96", fontSize: 12.5 }}>…</span>}
      {pages.map((p) => (
        <button
          key={p}
          className="btn"
          onClick={() => onChange(p)}
          style={{
            background: p === page ? ACCENT : "#F2F1EC",
            color: p === page ? "#fff" : "#181A1F",
            border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8, minWidth: 34,
          }}
        >
          {p}
        </button>
      ))}
      {pages[pages.length - 1] < pageCount && <span style={{ color: "#8A8D96", fontSize: 12.5 }}>…</span>}
      <button
        className="btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= pageCount}
        style={{ background: "#F2F1EC", color: "#181A1F", border: "none", fontSize: 12.5, fontWeight: 700, padding: "7px 12px", borderRadius: 8 }}
      >
        ›
      </button>
    </div>
  );
}
