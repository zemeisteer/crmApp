import { expect, test } from '@playwright/test';
import { api, apiLogin, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, PASSWORD, TARGET } from './support';

// The platform owner's pages: the overview, a center's subscription (plan,
// a payment recorded by hand) and the integration keys (saved encrypted,
// behind the admin's password, never shown again). Two centers: the one the
// platform admin signs in from, and the one being managed.
cleanUpStagingCenters();

// There is no way to become a platform admin through the product: the test
// promotes its own fresh account in the disposable database. Never on staging.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = TARGET === 'local' ? (require('../scripts/env.cjs') as { db: { url: string }; backendRequire: NodeRequire }) : null;
async function promote(email: string) {
  const { Client } = env!.backendRequire('pg') as typeof import('pg');
  const client = new Client({ connectionString: env!.db.url });
  await client.connect();
  try {
    const res = await client.query(`update users set role = 'SUPERADMIN' where email = $1`, [email]);
    expect(res.rowCount).toBe(1);
  } finally {
    await client.end();
  }
}

test('platform admin: overview, a subscription moved to a paid plan with a payment recorded by hand, integration keys behind the password', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const admin = await newCenter('pfadmin');
  const client = await newCenter('pfclient');
  await promote(admin.email);
  const plans = await api<Array<{ key: string; name: string; price?: number; monthlyPrice?: number; priceMonthly?: number }>>('GET', '/plans/public');
  const paid = plans.find((p) => Number(p.price ?? p.monthlyPrice ?? p.priceMonthly ?? 0) > 0);
  expect(paid, 'a paid plan exists').toBeTruthy();

  await loginOnMainSite(page, admin.email);
  // The account also owns a center: it lands there, and the platform pages are on the same address.
  await expectCenterDashboard(page, admin.sub);
  const origin = centerUrl(admin.sub);

  // --- Overview ------------------------------------------------------------
  await page.goto(`${origin}/admin/overview`);
  await expect(page.getByRole('heading', { name: 'Platforma holati' })).toBeVisible();
  // Figures are there (how many depends on what else this run made): the centers card and the plans.
  await expect(page.getByText('Faol markazlar', { exact: true })).toBeVisible();
  await expect(page.getByText(paid!.name).first()).toBeVisible();

  // --- Subscriptions: find the other center, change its plan, record a payment ---
  await page.goto(`${origin}/admin/subscriptions`);
  await expect(page.getByRole('heading', { name: 'Obunalar' })).toBeVisible();
  await page.getByLabel('Markaz yoki subdomen...').fill(client.sub);
  const row = page.getByRole('row').filter({ hasText: client.sub });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole('row').filter({ hasText: admin.sub })).toHaveCount(0);
  await row.getByRole('button', { name: 'Boshqarish' }).click();
  const manage = page.getByRole('dialog', { name: 'Obunani boshqarish' });
  await manage.getByRole('button', { name: 'Tarif', exact: true }).click();
  await page.getByRole('option', { name: paid!.name }).click();
  await manage.getByRole('button', { name: "O'zgarishlarni saqlash" }).click();
  await expect(manage.getByRole('status').filter({ hasText: 'Saqlandi' })).toBeVisible();

  const token = await apiLogin(admin.email);
  const before = await api<unknown[]>('GET', `/platform/subscriptions/${client.tenantId}/payments`, { token });
  expect(before).toEqual([]);
  await manage.getByLabel("Summa (so'm)").fill('250000');
  await manage.getByRole('button', { name: "To'lovni qayd etish" }).click();
  await expect(manage.getByRole('status').filter({ hasText: /^To'langan:/ })).toBeVisible();
  const after = await api<Array<{ amount: number; plan: string }>>('GET', `/platform/subscriptions/${client.tenantId}/payments`, { token });
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ amount: 250000 });
  // A wrong amount is refused in the form.
  await manage.getByLabel("Summa (so'm)").fill('');
  await manage.getByRole('button', { name: "To'lovni qayd etish" }).click();
  await expect(manage.getByRole('alert')).toBeVisible();
  expect(await api<unknown[]>('GET', `/platform/subscriptions/${client.tenantId}/payments`, { token })).toHaveLength(1);

  // The managed center's own owner cannot open any of this.
  const res = await fetch(`http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api/platform/subscriptions`, { headers: { Authorization: `Bearer ${client.token}` } });
  expect(res.status).toBe(403);

  // --- Integrations: a key is saved behind the password and never shown ------
  await page.goto(`${origin}/admin/integrations`);
  await expect(page.getByRole('heading', { name: 'API va integratsiyalar' })).toBeVisible();
  const card = page.getByTestId('integration-translate');
  await expect(card).toContainText('GOOGLE_TRANSLATE_API_KEY');
  const configure = card.getByRole('button', { name: 'Sozlash' });
  if ((await configure.count()) === 0) {
    // No SETTINGS_KEY on this server: keys are read-only here, and the page offers no form.
    test.info().annotations.push({ type: 'note', description: 'SETTINGS_KEY is not set on the test server: the key form was not exercised' });
    await expect(page.getByRole('button', { name: 'Sozlash' })).toHaveCount(0);
    return;
  }
  // A synthetic value, for this disposable server only.
  const value = `zzbr-synthetic-${Date.now()}`;
  await configure.click();
  const form = page.getByRole('dialog', { name: /Kalitlarni sozlash/ });
  await form.locator('#int-GOOGLE_TRANSLATE_API_KEY').fill(value);
  await form.locator('#int-admin-password').fill('not-the-password-1');
  await form.getByRole('button', { name: 'Shifrlab saqlash' }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await form.locator('#int-admin-password').fill(PASSWORD);
  await form.getByRole('button', { name: 'Shifrlab saqlash' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saqlandi va darhol kuchga kirdi.' })).toBeVisible();
  // Saved, in use, and not readable again - on the page or from the API.
  await expect(page.getByText(value)).toHaveCount(0);
  const list = await (await fetch(`http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api/platform/integrations`, { headers: { Authorization: `Bearer ${token}` } })).text();
  expect(list).not.toContain(value);
  expect(list).toContain('GOOGLE_TRANSLATE_API_KEY');
});
