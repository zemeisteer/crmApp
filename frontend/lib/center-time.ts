// The center's wall clock. Dates and times that staff type for a center
// (a lead's follow-up, a trial lesson) are the center's local time, in the
// center's IANA timezone (tenant.timezone, default Asia/Tashkent), whatever
// timezone the browser is in; the API receives and returns UTC instants.
// Shown back, an instant is again the center's local time. The backend
// reads "today" and "overdue" in the same zone (backend/src/common/timezone.ts).
//
// No imports: lib/center-time.test.ts runs it with `node --test`.

export const DEFAULT_CENTER_TIMEZONE = "Asia/Tashkent";

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The center's timezone, or the default when it is unset or unknown. */
export function centerTimeZone(tz: string | null | undefined): string {
  return isValidTimeZone(tz) ? tz : DEFAULT_CENTER_TIMEZONE;
}

interface Parts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

function partsIn(instant: Date, tz: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute) };
}

function offsetMinutes(instant: Date, tz: string): number {
  const p = partsIn(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{2}):(\d{2})$/;

/**
 * "2026-10-05" + "14:30" on the center's clock -> the UTC instant (ISO).
 * "" for an empty or malformed date or time. A wall time that does not
 * exist (skipped by a daylight-saving switch) moves forward, as clocks do.
 */
export function centerTimeToIso(date: string, time: string, tz: string): string {
  const d = DATE.exec(date ?? "");
  const t = TIME.exec(time ?? "");
  if (!d || !t) return "";
  const [y, m, day, hh, mm] = [Number(d[1]), Number(d[2]), Number(d[3]), Number(t[1]), Number(t[2])];
  if (m < 1 || m > 12 || day < 1 || day > 31 || hh > 23 || mm > 59) return "";
  const zone = centerTimeZone(tz);
  const naive = Date.UTC(y, m - 1, day, hh, mm);
  // Two passes settle the offset even when the guess crosses a DST switch.
  let guess = naive - offsetMinutes(new Date(naive), zone) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), zone) * 60_000;
  return new Date(guess).toISOString();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** An instant on the center's clock: { date: "YYYY-MM-DD", time: "HH:MM" }. */
export function isoToCenterParts(iso: string | number | Date, tz: string): { date: string; time: string } | null {
  const instant = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const p = partsIn(instant, centerTimeZone(tz));
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

/** Today's date on the center's clock (YYYY-MM-DD). */
export function centerToday(tz: string, now: Date = new Date()): string {
  return isoToCenterParts(now, tz)!.date;
}

/**
 * A Date whose local fields (getHours, getDate, ...) read the center's wall
 * clock at `instant` - for code written against local Date fields, such as
 * formatting or nextLessonDate. Only its fields mean anything, not its instant.
 */
export function centerWallClock(instant: string | number | Date, tz: string): Date | null {
  const parts = isoToCenterParts(instant, tz);
  if (!parts) return null;
  const [y, m, d] = parts.date.split("-").map(Number);
  const [hh, mm] = parts.time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}
