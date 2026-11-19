import { expect, test } from '@playwright/test';
import { api } from './support';
import { isLimitLine, planFeatureLines } from '../../frontend/lib/plans';

// The public site's tariff cards show each plan's feature list in the
// visitor's language (L-02); a language without its own list shows Uzbek.
// The branch/student/staff lines come from the plan's own limits (the numbers
// the app enforces), not from the admin's text (frontend/lib/plans.ts).
interface PublicPlan { name: string; features: string; featuresRu: string; featuresEn: string; entitlements?: Record<string, number | boolean | null> }
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

for (const lang of ['UZ', 'RU', 'EN'] as const) {
  test(`tariff features on the main site follow the language (${lang})`, async ({ page }) => {
    const plans = await api<PublicPlan[]>('GET', '/plans/public');
    expect(plans.length).toBeGreaterThan(0);
    await page.addInitScript((l) => localStorage.setItem('talimcrm_lang', l), lang);
    await page.goto('/');
    for (const p of plans) {
      const shown = planFeatureLines({ ...p, entitlements: p.entitlements ?? {} }, lang);
      for (const f of shown) await expect(page.getByText(f, { exact: true }).first()).toBeVisible();
      // The Uzbek text is not shown where a translation exists.
      const own = lines(lang === 'RU' ? p.featuresRu : lang === 'EN' ? p.featuresEn : p.features);
      if (lang !== 'UZ' && own.length) {
        for (const uz of lines(p.features).filter((u) => !isLimitLine(u) && !shown.includes(u))) await expect(page.getByText(uz, { exact: true })).toHaveCount(0);
      }
    }
  });
}
