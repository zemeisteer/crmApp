// Tariff feature lists are written per language by the platform admin; a
// language without its own list shows the Uzbek one.
export interface PlanFeatureText {
  features: string;
  featuresRu?: string | null;
  featuresEn?: string | null;
}

export function planFeatureLines(plan: PlanFeatureText, lang: string): string[] {
  const own = lang === "RU" ? plan.featuresRu : lang === "EN" ? plan.featuresEn : plan.features;
  const lines = (text: string | null | undefined) => (text ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const mine = lines(own);
  return mine.length ? mine : lines(plan.features);
}
