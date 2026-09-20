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
