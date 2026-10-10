import type { TenantStatus } from "@/lib/api";
import type { Lang, TranslationKey } from "@/lib/i18n";

// Shared by the platform admin's pages (overview, subscriptions).

export const STATUS_LABEL_KEYS: Record<TenantStatus, TranslationKey> = {
  TRIAL: "admin.statusTrial",
  ACTIVE: "admin.statusActive",
  PAST_DUE: "admin.statusPastDue",
  SUSPENDED: "admin.statusSuspended",
};

export const STATUS_COLORS: Record<TenantStatus, { bg: string; fg: string }> = {
  TRIAL: { bg: "#EEF0FF", fg: "#3730A3" },
  ACTIVE: { bg: "#E9F8EF", fg: "#16794A" },
  PAST_DUE: { bg: "#FFF7E6", fg: "#8A5A00" },
  SUSPENDED: { bg: "#FDEBEC", fg: "#B23A47" },
};

const LOCALE: Record<Lang, string> = { UZ: "uz-UZ", RU: "ru-RU", EN: "en-US" };
const UZ_MONTHS = ["Yanvar", "Fevral", "Mart", "Aprel", "May", "Iyun", "Iyul", "Avgust", "Sentabr", "Oktabr", "Noyabr", "Dekabr"];
// Not the first three letters: "Iyun" and "Iyul" would both read "Iyu".
const UZ_MONTHS_SHORT = ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"];

export function money(value: number): string {
  return new Intl.NumberFormat("uz-UZ").format(value).replace(/,/g, " ");
}

/** "2026-10" as a month name: "Oktabr 2026" / "Okt" (short, for chart axes). */
export function monthLabel(month: string, lang: Lang, style: "long" | "short" = "long"): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  if (lang === "UZ") return style === "short" ? UZ_MONTHS_SHORT[m - 1] : `${UZ_MONTHS[m - 1]} ${y}`;
  const date = new Date(Date.UTC(y, m - 1, 1));
  return style === "short"
    ? new Intl.DateTimeFormat(LOCALE[lang], { month: "short", timeZone: "UTC" }).format(date)
    : new Intl.DateTimeFormat(LOCALE[lang], { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

/** The month after "2026-10": "2026-11". */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}
