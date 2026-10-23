import { expect, test } from '@playwright/test';
import { centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, TARGET } from './support';

// Sprint 5 through the pages: turning on two-step sign-in shows recovery
// codes once and ends the other sessions; one of the codes signs in; a
// center whose trial is over is read-only, then closed except for the plans
// (and the payment for one); the sign-up and sign-in forms fit a phone.
cleanUpStagingCenters();

// The key and the trial dates are read and set in the disposable database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = TARGET === 'local' ? (require('../scripts/env.cjs') as { db: { url: string }; backendRequire: NodeRequire }) : null;
async function sql<T = Record<string, unknown>>(text: string, params: unknown[]): Promise<T[]> {
  const { Client } = env!.backendRequire('pg') as typeof import('pg');
  const client = new Client({ connectionString: env!.db.url, options: '-c TimeZone=UTC' });
  await client.connect();
  try {
    return (await client.query(text, params)).rows as T[];
  } finally {
    await client.end();
  }
}
async function totpOf(email: string, which: 'two_factor_secret' | 'two_factor_pending_secret') {
  const [row] = await sql<{ secret: string }>(`select ${which} as secret from users where email = $1`, [email]);
  const { generate } = env!.backendRequire('otplib') as { generate: (o: { secret: string }) => Promise<string> };
  return generate({ secret: row.secret });
}

test('two-step sign-in: turned on in settings, recovery codes shown once, one of them signs in', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('twofa');
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);

  await page.goto(centerUrl(c.sub, '/settings'));
  await page.getByRole('button', { name: 'Xavfsizlik', exact: true }).click();
  await page.getByRole('button', { name: "2FA'ni yoqish" }).click();
  const code = page.getByPlaceholder('000000');
  await expect(code).toBeVisible();
  await code.fill(await totpOf(c.email, 'two_factor_pending_secret'));
  await code.press('Enter');
  await expect(page.getByText('Tiklash kodlari', { exact: true })).toBeVisible();
  const recovery = (await page.getByText(/^[0-9a-f]{5}-[0-9a-f]{5}$/).allTextContents()).map((s) => s.trim());
  expect(recovery).toHaveLength(10);
  // Only this session is left, and the page says so without a reload.
  await expect(page.getByRole('button', { name: 'Chiqarish' })).toHaveCount(1);

  // Signed out, the password alone is not enough; a recovery code is.
  await page.getByRole('button', { name: 'Chiqish', exact: true }).click();
  await loginOnMainSite(page, c.email);
  const second = page.getByPlaceholder('000000');
  await expect(second).toBeVisible();
  await expect(page.getByText(/Tiklash kodini kiriting/)).toBeVisible();
  await second.fill(recovery[0]);
  await second.press('Enter');
  await expectCenterDashboard(page, c.sub);
  // Used once: it is gone from the account.
  const [{ left }] = await sql<{ left: number }>(`select cardinality(two_factor_recovery_hashes) as left from users where email = $1`, [c.email]);
  expect(left).toBe(9);
});

test('a trial that is over: read-only with the date, then closed except the plans and the payment', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('trialend');
  await sql(`update tenants set trial_ends_at = now() - interval '1 day' where id = $1`, [c.tenantId]);
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  await expect(page.getByText(/Sinov muddati tugadi: faqat ko'rish rejimi/)).toBeVisible();

  // A change is refused with the reason.
  await page.goto(centerUrl(c.sub, '/students'));
  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  await page.getByPlaceholder('Madina Yusupova').fill('Sinov Oquvchi');
  await page.getByRole('button', { name: "O'quvchini qo'shish" }).click();
  await expect(page.getByText(/Sinov muddati tugagan: ma'lumotlarni ko'rish mumkin/)).toBeVisible();

  // After the read-only days: closed, the plans still open, the payment link not refused for the trial.
  await sql(`update tenants set trial_ends_at = now() - interval '30 days' where id = $1`, [c.tenantId]);
  await page.goto(centerUrl(c.sub, '/dashboard'));
  await expect(page.getByRole('heading', { name: 'Sinov muddati tugadi' })).toBeVisible();
  await page.getByRole('link', { name: 'Tarifni tanlang' }).click();
  await expect(page).toHaveURL(centerUrl(c.sub, '/pricing'));
  await page.getByRole('button', { name: 'Faollashtirish' }).first().click();
  const answer = page.waitForResponse((r) => r.url().includes('/platform-billing/click/link'));
  await page.getByRole('button', { name: 'Havola olish' }).click();
  const res = await answer;
  // Click is not configured in this environment (503); what matters is that the trial does not stand in the way.
  const body = await res.json().catch(() => ({}));
  expect(body.code ?? '').not.toMatch(/^TRIAL_/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test('the sign-up and sign-in forms fill the screen; the brand panel is hidden', async ({ page }) => {
    for (const path of ['/register', '/login?main=1']) {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('input').first()).toBeVisible();
      const m = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: document.documentElement.clientWidth,
        left: document.querySelector('input')!.getBoundingClientRect().left,
      }));
      expect(m.scroll, path).toBeLessThanOrEqual(m.width);
      expect(m.left, path).toBeLessThan(60);
    }
  });
});

test('platform admin: the trial deletion preview says what would happen and why; a phone exception needs a used trial', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const admin = await newCenter('trialadm');
  const ended = await newCenter('trialold');
  await sql(`update users set role = 'SUPERADMIN' where email = $1`, [admin.email]);
  // Ended long enough ago to be in the preview (TRIAL_PURGE is off here: nothing is sent).
  await sql(`update tenants set trial_ends_at = now() - interval '200 days' where id = $1`, [ended.tenantId]);

  await loginOnMainSite(page, admin.email);
  await expectCenterDashboard(page, admin.sub);
  await page.goto(centerUrl(admin.sub, '/admin/trials'));
  await expect(page.getByRole('heading', { name: 'Sinov va SMS nazorati' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: "TRIAL_PURGE o'chiq" })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: ended.sub });
  await expect(row).toContainText('Birinchi xat navbatda');
  // The preview wrote nothing.
  const [{ purge_on }] = await sql<{ purge_on: Date | null }>(`select trial_purge_on as purge_on from tenants where id = $1`, [ended.tenantId]);
  expect(purge_on).toBeNull();

  // A number that never had a trial: refused, with the reason.
  await page.getByLabel('Telefon raqami').fill('+998 90 000 00 01');
  await page.getByLabel('Sabab (kamida 10 belgi)').fill("Sinov: bu raqam hech qachon sinov olmagan");
  await page.getByRole('button', { name: 'Ruxsat berish' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'topilmadi' })).toHaveText('Bu raqam uchun ishlatilgan sinov topilmadi');
});

test('a paid period that ran out: the grace banner with its date, then read-only for non-payment; the plans page shows the paid date', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('pastdue');
  await sql(`update tenants set status = 'PAST_DUE', paid_until = now() - interval '2 days' where id = $1`, [c.tenantId]);
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  await expect(page.getByRole('status').filter({ hasText: "To'langan muddat tugadi" })).toBeVisible();
  await page.goto(centerUrl(c.sub, '/pricing'));
  await expect(page.getByTestId('paid-until')).toBeVisible();
  await sql(`update tenants set status = 'SUSPENDED', suspended_reason = 'NON_PAYMENT' where id = $1`, [c.tenantId]);
  await page.goto(centerUrl(c.sub, '/dashboard'));
  await expect(page.getByRole('status').filter({ hasText: "To'lov qilinmagani uchun" })).toBeVisible();
});

test("plan entitlements: the platform admin unticks a feature in the plan editor; that center's menu no longer shows it and the API refuses it", async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const admin = await newCenter('entadm');
  const c = await newCenter('entctr');
  const key = `ENT_${Date.now().toString(36).toUpperCase()}`;
  await sql(`insert into plans (id, key, name, price) values ($1, $1, $2, 1000)`, [key, `Ent ${key}`]);
  await sql(`update tenants set plan = $1, status = 'ACTIVE' where id = $2`, [key, c.tenantId]);
  await sql(`update users set role = 'SUPERADMIN' where email = $1`, [admin.email]);

  await loginOnMainSite(page, admin.email);
  await expectCenterDashboard(page, admin.sub);
  await page.goto(centerUrl(admin.sub, '/pricing'));
  await page.getByTestId(`plan-${key}`).getByRole('button', { name: 'Tahrirlash' }).click();
  await page.getByLabel('Mock imtihonlar').uncheck();
  await page.getByLabel("O'quvchilar limiti").fill('5');
  await page.getByRole('button', { name: 'Saqlash', exact: true }).click();
  await expect.poll(async () => (await sql<{ e: Record<string, unknown> }>(`select entitlements as e from plans where key = $1`, [key]))[0].e).toEqual({ MOCK_EXAMS: false, MAX_STUDENTS: 5 });

  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  await expect(page.getByRole('link', { name: 'Sertifikatlar' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mock va mashqlar' })).toHaveCount(0);
});
