// Pure helpers for the make-up lessons and calendar sync screens: dates as
// the server keeps them (center-local YYYY-MM-DD strings), the error codes
// the server answers with, and subscription links for calendar apps.
// No runtime imports: unit-tested with node --test (makeups.test.ts).

/** YYYY-MM-DD plus `days` (calendar arithmetic, no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD string as a local Date at midnight (for formatting only). */
export function localDate(date: string): Date | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 0 = Monday ... 6 = Sunday, of a YYYY-MM-DD string. */
export function weekdayIndex(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 6 : d - 1;
}

/** The longest date range the make-up and lesson lists accept. */
export const MAX_RANGE_DAYS = 120;

/** null when the range is fine; otherwise why not. */
export function rangeProblem(from: string, to: string): "INVALID" | "TOO_LONG" | null {
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || to < from) return "INVALID";
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return "TOO_LONG";
  return null;
}

/** Codes the make-up and lesson routes answer with (body.code). */
export const MAKEUP_ERROR_CODES = [
  "NOT_ELIGIBLE", "DUPLICATE_CREDIT", "CREDIT_NOT_OPEN", "CREDIT_NOT_FORFEITED", "CREDIT_EXPIRED", "LESSON_FULL",
  "SLOT_TAKEN", "STUDENT_BUSY", "NO_LESSON", "ALREADY_IN_GROUP", "BOOKING_CLOSED", "ALREADY_MARKED",
  "ALREADY_CANCELLED", "CREDITS_ISSUED",
] as const;
export type MakeupErrorCode = (typeof MAKEUP_ERROR_CODES)[number];

/** The known code of an error's JSON body, if any. */
export function makeupErrorCode(err: unknown): MakeupErrorCode | null {
  const body = (err as { body?: { code?: unknown } | null } | null)?.body;
  const code = body && typeof body.code === "string" ? body.code : null;
  return code && (MAKEUP_ERROR_CODES as readonly string[]).includes(code) ? (code as MakeupErrorCode) : null;
}

/** Whether HH:MM `end` comes after `start` (both valid times). */
export function validTimeRange(start: string, end: string): boolean {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/;
  return re.test(start) && re.test(end) && end > start;
}

/** webcal:// form of an http(s) subscription link (Apple Calendar, Outlook). */
export function webcalUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "webcal://");
}

/** Google Calendar's "add by URL" page for a subscription link. */
export function googleSubscribeUrl(url: string): string {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}`;
}

/** The outcome Google's consent screen sent the browser back with (?google=...). */
export type GoogleReturn = "connected" | "denied" | "expired" | "error";
export function googleReturn(search: string): GoogleReturn | null {
  const v = new URLSearchParams(search).get("google");
  return v === "connected" || v === "denied" || v === "expired" || v === "error" ? v : null;
}
