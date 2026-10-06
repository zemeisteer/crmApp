import type { TranslationKey } from "./i18n";

// Lesson days are stored as "MON,WED,FRI" (or older Uzbek names); people
// read them as "Du, Cho, Ju" in their language.
const DAY_KEYS: Record<string, TranslationKey> = {
  dushanba: "weekday.short.monday", seshanba: "weekday.short.tuesday", chorshanba: "weekday.short.wednesday",
  payshanba: "weekday.short.thursday", juma: "weekday.short.friday", shanba: "weekday.short.saturday", yakshanba: "weekday.short.sunday",
  mon: "weekday.short.monday", tue: "weekday.short.tuesday", wed: "weekday.short.wednesday", thu: "weekday.short.thursday",
  fri: "weekday.short.friday", sat: "weekday.short.saturday", sun: "weekday.short.sunday",
};

export function scheduleDaysLabel(raw: string | null | undefined, t: (k: TranslationKey) => string, sep = ", ") {
  return (raw ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (DAY_KEYS[d.toLowerCase()] ? t(DAY_KEYS[d.toLowerCase()]) : d))
    .join(sep);
}
