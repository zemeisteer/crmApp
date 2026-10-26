import { expect, test, type Page } from '@playwright/test';
import { api, apiLogin, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, TARGET } from './support';

// Paying the platform by card, through the pages: a new center picks a
// tariff, sends a receipt; the platform admin opens it, rejects it with a
// reason; the center sees why and sends again; the admin confirms; the
// center sees the receipt confirmed and its paid time. Also: the modal on a
// phone, and Escape closing it.
cleanUpStagingCenters();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const env = TARGET === 'local' ? (require('../scripts/env.cjs') as { db: { url: string }; backendRequire: NodeRequire }) : null;
async function sql(text: string, params: unknown[]) {
  const { Client } = env!.backendRequire('pg') as typeof import('pg');
  const client = new Client({ connectionString: env!.db.url });
  await client.connect();
  try {
    return (await client.query(text, params)).rows;
  } finally {
    await client.end();
  }
}

// A real 1x1 PNG: the admin's window shows it as a picture.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function sendReceipt(page: Page, sub: string, planName: string, nextMonth: string) {
  await page.goto(centerUrl(sub, '/pricing'));
  const planCard = page.locator('div').filter({ has: page.getByText(planName, { exact: true }) }).filter({ has: page.getByRole('button') }).last();
  await planCard.getByRole('button', { name: /Faollashtirish|To'lash \/ uzaytirish/ }).click();
  const dialog = page.getByRole('dialog');
  const pay = dialog.getByTestId('platform-card-pay');
  await expect(pay).toBeVisible();
  await expect(pay).toContainText('9860 0000 0000 0001');
  await expect(pay).toContainText('TEST PLATFORMA');
  // The month shown is the server's.
  await expect(pay).toContainText(nextMonth);
  await pay.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG });
  await expect(pay).toContainText('chek.png');
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(dialog.getByRole('status')).toContainText('Chek yuborildi');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('card payment: a center sends a receipt, the platform admin rejects then confirms, the center sees each result', async ({ page, browser }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const admin = await newCenter('pcadm');
  const customer = await newCenter('pccus');
  await sql(`update users set role = 'SUPERADMIN' where email = $1`, [admin.email]);
  const plans = await api<Array<{ key: string; name: string; price: number }>>('GET', '/plans/public');
  const paid = plans.find((p) => p.price > 0)!;
  const view = await api<{ nextMonth: string }>('GET', '/platform-billing/card', { token: customer.token });

  // --- The center sends a receipt -------------------------------------------
  await loginOnMainSite(page, customer.email);
  await expectCenterDashboard(page, customer.sub);
  await sendReceipt(page, customer.sub, paid.name, view.nextMonth);
  const mine = page.getByTestId('platform-card-claims');
  await expect(mine).toContainText('Tekshirilmoqda');

  // --- The platform admin, in another browser: opens it and rejects it ------
  const adminCtx = await browser.newContext();
  const ap = await adminCtx.newPage();
  await loginOnMainSite(ap, admin.email);
  await expectCenterDashboard(ap, admin.sub);
  await ap.goto(centerUrl(admin.sub, '/admin/subscriptions?tab=cards'));
  const list = ap.getByTestId('platform-card-claims-admin');
  const row = list.getByTestId('platform-card-claim').filter({ hasText: customer.sub });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Tekshirish' }).click();
  const modal = ap.getByTestId('platform-card-claim-modal');
  await expect(modal.getByRole('img', { name: "To'lov cheki" })).toBeVisible();
  // Escape closes the window; it opens again.
  await ap.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await row.getByRole('button', { name: 'Tekshirish' }).click();
  await modal.getByRole('button', { name: 'Rad etish' }).click();
  await modal.getByLabel("Rad etish sababi (o'quvchi ko'radi)").fill("Summa to'g'ri emas");
  await modal.getByRole('button', { name: 'Rad etish' }).click();
  await expect(list.getByRole('status')).toContainText('rad etildi');
  await expect(list.getByTestId('platform-card-claim').filter({ hasText: customer.sub })).toHaveCount(0);

  // --- The center sees why, and sends again ----------------------------------
  await page.reload();
  await expect(mine).toContainText("Rad etildi: Summa to'g'ri emas");
  await sendReceipt(page, customer.sub, paid.name, view.nextMonth);

  // --- The admin confirms ----------------------------------------------------
  await ap.reload();
  const again = list.getByTestId('platform-card-claim').filter({ hasText: customer.sub });
  await expect(again).toHaveCount(1);
  await again.getByRole('button', { name: 'Tekshirish' }).click();
  ap.once('dialog', (d) => d.accept());
  await modal.getByRole('button', { name: /Tasdiqlash/ }).click();
  await expect(list.getByRole('status')).toContainText('tasdiqlandi');

  // --- The center sees it confirmed and its paid time ------------------------
  await page.reload();
  await expect(mine).toContainText('Tasdiqlandi');
  const me = await api<{ tenant?: { billing?: { paidUntil: string | null } }; billing?: { paidUntil: string | null } }>('GET', '/auth/me', { token: await apiLogin(customer.email) });
  expect((me.tenant?.billing ?? me.billing)?.paidUntil).toBeTruthy();
  await expect(page.getByTestId('paid-until')).toBeVisible();
  await adminCtx.close();
});

test('card payment on a phone: the payment window fits the screen and is usable', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('pcmob');
  const plans = await api<Array<{ name: string; price: number }>>('GET', '/plans/public');
  const paid = plans.find((p) => p.price > 0)!;
  await page.setViewportSize({ width: 390, height: 844 });
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  await page.goto(centerUrl(c.sub, '/pricing'));
  const planCard = page.locator('div').filter({ has: page.getByText(paid.name, { exact: true }) }).filter({ has: page.getByRole('button') }).last();
  await planCard.getByRole('button', { name: 'Faollashtirish' }).click();
  const pay = page.getByRole('dialog').getByTestId('platform-card-pay');
  await expect(pay).toBeVisible();
  await expect(pay.getByRole('button', { name: 'Chekni yuborish' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Sending without a picture says what is missing.
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(pay.getByRole('alert')).toContainText('Chek rasmini tanlang');
});
