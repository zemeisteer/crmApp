import type { TranslationKey } from "./i18n";

// Level names for a placement result: CEFR bands for English, plain
// beginner/intermediate/advanced otherwise.
export function placementLevelName(subject: string, level: number, t: (k: TranslationKey) => string) {
  const english = /ingliz|english|ielts|cefr/i.test(subject);
  const keys: TranslationKey[] = english
    ? ["placement.lvlEn1", "placement.lvlEn2", "placement.lvlEn3"]
    : ["placement.lvl1", "placement.lvl2", "placement.lvl3"];
  return t(keys[Math.min(3, Math.max(1, level)) - 1]);
}

export function placementLink(token: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/t/${token}`;
}
