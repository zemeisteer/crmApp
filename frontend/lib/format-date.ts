import type { Lang } from "./i18n";

// Browsers have poor Uzbek locale data: toLocaleDateString("uz-UZ") prints
// "2026 M09 26". Uzbek dates are built by hand; RU/EN use Intl.

const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentabr", "oktabr", "noyabr", "dekabr"];
const UZ_MONTHS_SHORT = ["yan", "fev", "mar", "apr", "may", "iyn", "iyl", "avg", "sen", "okt", "noy", "dek"];

export type DateStyle = "long" | "short" | "dayMonth" | "numeric";

export function formatDate(value: string | number | Date | null | undefined, lang: Lang, style: DateStyle = "long"): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const day = d.getDate();
  const month = d.getMonth();
  const year = d.getFullYear();
  if (style === "numeric") {
    return `${String(day).padStart(2, "0")}.${String(month + 1).padStart(2, "0")}.${year}`;
  }
  if (lang === "UZ") {
    if (style === "long") return `${day} ${UZ_MONTHS[month]} ${year}`;
    if (style === "short") return `${day} ${UZ_MONTHS_SHORT[month]} ${year}`;
    return `${day} ${UZ_MONTHS[month]}`;
  }
  const locale = lang === "RU" ? "ru-RU" : "en-US";
  const opts: Intl.DateTimeFormatOptions =
    style === "long" ? { day: "numeric", month: "long", year: "numeric" }
    : style === "short" ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "long" };
  return d.toLocaleDateString(locale, opts);
}

export function formatTime(value: string | number | Date, lang: Lang): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toLocaleTimeString(lang === "RU" ? "ru-RU" : lang === "EN" ? "en-US" : "ru-RU", { hour: "2-digit", minute: "2-digit" });
}

// "26 sen 2026, 14:35"
export function formatDateTime(value: string | number | Date | null | undefined, lang: Lang): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d, lang, "short")}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
