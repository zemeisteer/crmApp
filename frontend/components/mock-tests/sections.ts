import type { MockSection } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export const SECTION_ICON: Record<MockSection, string> = { listening: "🎧", reading: "📖", writing: "✍️", speaking: "🎤" };
export const sectionKey = (s: MockSection) => `mock.sec.${s}` as TranslationKey;
