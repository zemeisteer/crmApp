// groups.scheduleDays holds Uzbek day names (the UI writes them, e.g.
// "Dushanba,Chorshanba"); English codes ("MON,WED") are accepted too.
// Index = ISO weekday - 1 (1 = Monday ... 7 = Sunday).
const WEEKDAY_NAMES = [
  ['dushanba', 'mon'], ['seshanba', 'tue'], ['chorshanba', 'wed'], ['payshanba', 'thu'],
  ['juma', 'fri'], ['shanba', 'sat'], ['yakshanba', 'sun'],
];

// ISO weekdays (1-7) named in a scheduleDays string, sorted, no duplicates.
export function isoWeekdaysOf(scheduleDays: string | null | undefined): number[] {
  const days = new Set<number>();
  for (const raw of (scheduleDays ?? '').split(',')) {
    const d = raw.trim().toLowerCase();
    const idx = WEEKDAY_NAMES.findIndex((names) => names.includes(d));
    if (idx >= 0) days.add(idx + 1);
  }
  return [...days].sort((a, b) => a - b);
}

export function runsOn(scheduleDays: string | null | undefined, isoWeekday: number) {
  return isoWeekdaysOf(scheduleDays).includes(isoWeekday);
}

// "16:00" + 90 -> "17:30" (clamped to 23:59).
export function addMinutes(hhmm: string, minutes: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutes);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export const DEFAULT_LESSON_MINUTES = 90;
