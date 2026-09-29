// Local (not UTC) date helpers — `toISOString()` converts to UTC first, which
// silently rolls the date/month back near midnight in timezones ahead of UTC
// (e.g. Asia/Tashkent, UTC+5). These build the string from local components.

export function localDateStr(d: Date = new Date()) {
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

export function localMonthStr(d: Date = new Date()) {
  return localDateStr(d).slice(0, 7);
}

// Weekday (1 = Monday ... 7 = Sunday) of one scheduleDays token, in Uzbek,
// Russian or English, full or short ("Dushanba", "chor", "Wed", "ср").
function weekdayOf(token: string): number | null {
  const w = token.trim().toLowerCase().replace(/[^a-zа-яёʻ']/g, "");
  if (!w) return null;
  const table: Array<[number, string[]]> = [
    [1, ["dushanba", "dush", "du", "mon", "monday", "пн", "понедельник"]],
    [2, ["seshanba", "sesh", "se", "tue", "tuesday", "вт", "вторник"]],
    [3, ["chorshanba", "chor", "ch", "wed", "wednesday", "ср", "среда"]],
    [4, ["payshanba", "pay", "pa", "thu", "thursday", "чт", "четверг"]],
    [5, ["juma", "ju", "fri", "friday", "пт", "пятница"]],
    [6, ["shanba", "sha", "sh", "sat", "saturday", "сб", "суббота"]],
    [7, ["yakshanba", "yak", "ya", "sun", "sunday", "вс", "воскресенье"]],
  ];
  for (const [n, names] of table) if (names.includes(w)) return n;
  return null;
}

/**
 * The group's next lesson date (YYYY-MM-DD, local) from its scheduleDays
 * ("Dushanba,Chorshanba") and start time: today if the lesson has not
 * started yet, otherwise the next matching day. Null when days are unknown.
 */
export function nextLessonDate(scheduleDays: string | null | undefined, startTime: string | null | undefined, now: Date = new Date()): string | null {
  const days = new Set((scheduleDays ?? "").split(/[,;/\s]+/).map(weekdayOf).filter((d): d is number => d !== null));
  if (days.size === 0) return null;
  const hm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (let i = 0; i < 8; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const dow = d.getDay() === 0 ? 7 : d.getDay();
    if (!days.has(dow)) continue;
    if (i === 0 && startTime && startTime.slice(0, 5) <= hm) continue;
    return localDateStr(d);
  }
  return null;
}
