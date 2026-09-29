import type { MockLevel } from "@/lib/api";
import type { TranslationKey } from "@/lib/i18n";

export const levelKey = (l: MockLevel) => `mock.lvl.${l}` as TranslationKey;
