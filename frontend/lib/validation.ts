// Shared input-validation patterns, applied via the native `pattern` attribute
// so the browser blocks submission and shows its own inline hint.

// Uzbek phone numbers: +998 followed by 9 digits, optional spaces/dashes.
export const PHONE_PATTERN = "^\\+?998[\\s-]?\\d{2}[\\s-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}$";
export const PHONE_TITLE = "Masalan: +998 90 123 45 67";

// Full names: letters (Latin + Cyrillic), spaces, apostrophes and hyphens only — no digits.
export const NAME_PATTERN = "^[A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЎўҚқҒғҲҳ' \\-]{2,80}$";
export const NAME_TITLE = "Faqat harflar, bo'sh joy va chiziqcha";
