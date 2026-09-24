// IANA-timezone helpers built on Intl, so zones with daylight saving time
// are handled correctly (no fixed offsets).

export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // ISO: 1 = Monday … 7 = Sunday
}

// Wall-clock fields of `instant` as seen in `tz`.
export function zonedParts(instant: Date, tz: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(instant).map((x) => [x.type, x.value]));
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: weekdays.indexOf(p.weekday) + 1,
  };
}

// Offset of `tz` from UTC at `instant`, in minutes (Tashkent: +300).
export function offsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  const truncated = Math.floor(instant.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - truncated) / 60_000);
}

// The instant at which the wall clock in `tz` shows the given local time.
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle the offset even when the guess crosses a DST switch.
  let guess = naive - offsetMinutes(new Date(naive), tz) * 60_000;
  guess = naive - offsetMinutes(new Date(guess), tz) * 60_000;
  return new Date(guess);
}

// Start and end (exclusive) of the local calendar day containing `now`.
export function zonedDayBounds(now: Date, tz: string) {
  const p = zonedParts(now, tz);
  const startOfToday = zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const endOfToday = zonedTimeToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz);
  return { startOfToday, endOfToday };
}

export function formatZoned(instant: Date, tz: string) {
  const p = zonedParts(instant, tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}
