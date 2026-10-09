import { expect, test } from '@playwright/test';
import { api } from './support';

// The public site's tariff cards show each plan's feature list in the
// visitor's language (L-02); a language without its own list shows Uzbek.
interface PublicPlan { name: string; features: string; featuresRu: string; featuresEn: string }
const lines = (s: string) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

for (const lang of ['UZ', 'RU', 'EN'] as const) {
  test(`tariff features on the main site follow the language (${lang})`, async ({ page }) => {
    const plans = await api<PublicPlan[]>('GET', '/plans/public');
    expect(plans.length).toBeGreaterThan(0);
    await page.addInitScript((l) => localStorage.setItem('talimcrm_lang', l), lang);
    await page.goto('/');
    for (const p of plans) {
      const own = lines(lang === 'RU' ? p.featuresRu : lang === 'EN' ? p.featuresEn : p.features);
      const shown = own.length ? own : lines(p.features);
      for (const f of shown) await expect(page.getByText(f, { exact: true }).first()).toBeVisible();
      // The Uzbek text is not shown where a translation exists.
      if (lang !== 'UZ' && own.length) {
        for (const uz of lines(p.features).filter((u) => !shown.includes(u))) await expect(page.getByText(uz, { exact: true })).toHaveCount(0);
      }
    }
  });
}
