// Pure helpers for lists the server pages (students, payments): the page
// shape the API answers with, page arithmetic and query strings.
// No runtime imports: unit-tested with node --test (list-paging.test.ts).

/** One page of a list, as GET /students, /payments, /attendance answer when `page` is given. */
export interface PageOf<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** How many pages `total` rows fill (at least one, so "page 1 of 1" for an empty list). */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

/** `page` kept inside 1..pageCount (e.g. after the last row of the last page was deleted). */
export function clampPage(page: number, total: number, pageSize: number): number {
  const p = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, p), pageCount(total, pageSize));
}

/** 1-based numbers of the first and last row shown ("21–25 of 25"); 0–0 when nothing is shown. */
export function pageRange(page: number, pageSize: number, total: number, shown: number): { from: number; to: number } {
  if (total <= 0 || shown <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: Math.min(total, from + shown - 1) };
}

/** A page number from the address bar (`?page=2`); anything else is page 1. */
export function parsePageParam(value: string | null | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/** "?a=1&b=x" from the given values, leaving out empty ones; "" when none is left. */
export function pageQuery(params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * One page of a list already in memory, in the server's page shape. Used
 * when a filter the server cannot apply is on: the whole (server-filtered)
 * list is fetched, filtered here, and paged here, so totals stay right.
 */
export function slicePage<T>(items: T[], page: number, pageSize: number): PageOf<T> {
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total: items.length, page, pageSize };
}

/** Text with {name} placeholders filled in ("{from}–{to} of {total}"). */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}

// Where a list was (its "?q=…&page=…"), kept for this tab only, so a screen
// opened from the list (a student's profile) can send the user back to the
// same page after deleting a record. Storage may be unavailable (private
// mode, blocked site data): then the list simply opens on its first page.
const RETURN_PREFIX = "talimcrm_list_return:";

export function rememberListQuery(list: string, query: string): void {
  try {
    if (query) sessionStorage.setItem(RETURN_PREFIX + list, query);
    else sessionStorage.removeItem(RETURN_PREFIX + list);
  } catch {
    /* no storage: nothing to remember */
  }
}

/** `path` plus the remembered query of `list`, if any. */
export function listReturnHref(list: string, path: string): string {
  try {
    const q = sessionStorage.getItem(RETURN_PREFIX + list);
    if (q && q.startsWith("?")) return path + q;
  } catch {
    /* no storage */
  }
  return path;
}
