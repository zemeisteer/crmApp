// Shared input-validation patterns, applied via the native `pattern` attribute
// so the browser blocks submission and shows its own inline hint.

// Uzbek phone numbers: +998 followed by 9 digits, optional spaces/dashes.
export const PHONE_PATTERN = "^\\+?998[\\s-]?\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}$";
export const PHONE_TITLE = "Masalan: +998 90 123 45 67";

// Full names: letters (Latin + Cyrillic), spaces, apostrophes and hyphens only — no digits.
export const NAME_PATTERN = "^[A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЎўҚқҒғҲҳ' \\-]{2,80}$";
export const NAME_TITLE = "Faqat harflar, bo'sh joy va chiziqcha";

// Uzbek phone as it is typed: "+998" is always there and the 9 local
// digits are grouped "+998 90 123 45 67". Accepts pasted numbers with or
// without the country code - also a full "+998..." pasted after the "+998 "
// the field already shows, where the code then appears twice.
export function formatUzPhone(raw: string) {
  let d = raw.replace(/\D/g, "");
  if ((raw.trim().startsWith("+") || d.length > 9) && d.startsWith("998")) d = d.slice(3);
  if (d.length > 9 && d.startsWith("998")) d = d.slice(3);
  d = d.slice(0, 9);
  let res = "+998 ";
  if (d.length > 0) res += d.slice(0, 2);
  if (d.length > 2) res += ` ${d.slice(2, 5)}`;
  if (d.length > 5) res += ` ${d.slice(5, 7)}`;
  if (d.length > 7) res += ` ${d.slice(7, 9)}`;
  return res;
}

// True when all 9 local digits are there (an empty "+998 " is not a number).
export function isCompleteUzPhone(v: string) {
  return /^\+998 \d{2} \d{3} \d{2} \d{2}$/.test(formatUzPhone(v));
}

// "" for an untouched field, so optional phones are not sent as "+998 ".
export function phoneOrEmpty(v: string) {
  return v.replace(/\D/g, "").length > 3 ? v.trim() : "";
}
