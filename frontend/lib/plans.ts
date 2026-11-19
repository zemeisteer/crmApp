// Tariff feature lists are written per language by the platform admin; a
// language without its own list shows the Uzbek one.
//
// The limits (branches, students, staff) are not taken from that text: they
// are written out from the plan's own limits, the numbers the app enforces,
// so the list can never say "50 students" while the plan allows any number.
// A line of the admin's text that states such a limit is left out.
export interface PlanFeatureText {
  features: string;
  featuresRu?: string | null;
  featuresEn?: string | null;
  entitlements?: Record<string, number | boolean | null | undefined> | null;
}

type Lang = "UZ" | "RU" | "EN";
type LimitKey = "MAX_BRANCHES" | "MAX_STUDENTS" | "MAX_STAFF";
const LIMIT_ORDER: LimitKey[] = ["MAX_BRANCHES", "MAX_STUDENTS", "MAX_STAFF"];

const WORDS: Record<LimitKey, Record<Lang, { one?: string; upTo: (n: number) => string; unlimited: string }>> = {
  MAX_BRANCHES: {
    UZ: { one: "1 filial", upTo: (n) => `${n} tagacha filial`, unlimited: "Cheksiz filial" },
    RU: { one: "1 филиал", upTo: (n) => `До ${n} филиалов`, unlimited: "Без ограничения филиалов" },
    EN: { one: "1 branch", upTo: (n) => `Up to ${n} branches`, unlimited: "Unlimited branches" },
  },
  MAX_STUDENTS: {
    UZ: { upTo: (n) => `${n} tagacha o'quvchi`, unlimited: "Cheksiz o'quvchi" },
    RU: { upTo: (n) => `До ${n} учеников`, unlimited: "Без ограничения учеников" },
    EN: { upTo: (n) => `Up to ${n} students`, unlimited: "Unlimited students" },
  },
  MAX_STAFF: {
    UZ: { upTo: (n) => `${n} tagacha xodim`, unlimited: "Cheksiz xodim" },
    RU: { upTo: (n) => `До ${n} сотрудников`, unlimited: "Без ограничения сотрудников" },
    EN: { upTo: (n) => `Up to ${n} staff`, unlimited: "Unlimited staff" },
  },
};

// A line that states a limit: names branches, students or staff and gives a
// number or says "unlimited", in any of the three languages.
const LIMIT_SUBJECT = /(filial|o['‘’`ʻ]?quvchi|xodim|branch|student|staff|филиал|учени|сотрудник)/i;
const LIMIT_AMOUNT = /(\d|cheksiz|unlimited|без\s+огранич|безлимит)/i;
export const isLimitLine = (line: string) => LIMIT_SUBJECT.test(line) && LIMIT_AMOUNT.test(line);

/** The plan's limits in words, or [] when the plan carries no limits object. */
export function planLimitLines(plan: Pick<PlanFeatureText, "entitlements">, lang: string): string[] {
  const e = plan.entitlements;
  if (!e) return [];
  const l: Lang = lang === "RU" || lang === "EN" ? lang : "UZ";
  return LIMIT_ORDER.map((key) => {
    const v = e[key];
    const words = WORDS[key][l];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return words.unlimited;
    return v === 1 && words.one ? words.one : words.upTo(v);
  });
}

export function planFeatureLines(plan: PlanFeatureText, lang: string): string[] {
  const own = lang === "RU" ? plan.featuresRu : lang === "EN" ? plan.featuresEn : plan.features;
  const lines = (text: string | null | undefined) => (text ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const mine = lines(own);
  const text = mine.length ? mine : lines(plan.features);
  if (!plan.entitlements) return text;
  return [...planLimitLines(plan, lang), ...text.filter((line) => !isLimitLine(line))];
}
