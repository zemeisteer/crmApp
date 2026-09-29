import type { TranslationKey } from "./i18n";
import { centerSiteUrl } from "./domain";

// Level names for a placement result: CEFR bands for English, plain
// beginner/intermediate/advanced otherwise.
export function placementLevelName(subject: string, level: number, t: (k: TranslationKey) => string) {
  const english = /ingliz|english|ielts|cefr/i.test(subject);
  const keys: TranslationKey[] = english
    ? ["placement.lvlEn1", "placement.lvlEn2", "placement.lvlEn3"]
    : ["placement.lvl1", "placement.lvl2", "placement.lvl3"];
  return t(keys[Math.min(3, Math.max(1, level)) - 1]);
}

// Test links point at the center's own site (<sub>.<ROOT_DOMAIN>/t/<token>),
// so the student sees the center's address, not the admin panel's.
export function placementLink(token: string, subdomain?: string | null) {
  if (subdomain) return `${centerSiteUrl(subdomain)}/t/${token}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/t/${token}`;
}

// The message sent with the link: what the test is and how to take it.
export function placementShareText(
  info: { centerName?: string | null; title: string; subject: string; questionCount?: number },
  t: (k: TranslationKey) => string,
) {
  const lines = [
    `🎓 ${info.centerName ? `${info.centerName} — ` : ""}${t("placement.shareHead")}`,
    "",
    `📘 ${info.title}${info.subject && !info.title.toLowerCase().includes(info.subject.toLowerCase()) ? ` (${info.subject})` : ""}`,
  ];
  if (info.questionCount) lines.push(`📝 ${info.questionCount} ${t("placement.questions")}`);
  lines.push("", t("placement.shareHow"), `1️⃣ ${t("placement.shareStep1")}`, `2️⃣ ${t("placement.shareStep2")}`, `3️⃣ ${t("placement.shareStep3")}`);
  return lines.join("\n");
}

export function telegramShareUrl(link: string, text: string) {
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}
