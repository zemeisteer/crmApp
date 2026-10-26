import { expect, test, type Page } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, TARGET } from './support';

// Sending a platform receipt when the network misbehaves: the answer to a
// send is lost (the server did get it); the user retries, or picks another
// picture; two tabs send at once. Never two receipts, never the old receipt
// shown as the new one's success.
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

const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

async function openPay(page: Page, sub: string) {
  const plans = await api<Array<{ name: string; price: number }>>('GET', '/plans/public');
  const paid = plans.find((p) => p.price > 0)!;
  await page.goto(centerUrl(sub, '/pricing'));
  const planCard = page.locator('div').filter({ has: page.getByText(paid.name, { exact: true }) }).filter({ has: page.getByRole('button') }).last();
  await planCard.getByRole('button', { name: /Faollashtirish|To'lash \/ uzaytirish/ }).click();
  const pay = page.getByRole('dialog').getByTestId('platform-card-pay');
  await expect(pay).toBeVisible();
  return pay;
}

/** The next send reaches the server, but its answer never comes back. */
async function loseNextAnswer(page: Page) {
  let done = false;
  await page.route('**/api/platform-billing/card', async (route) => {
    if (done || route.request().method() !== 'POST') return route.fallback();
    done = true;
    await route.fetch(); // the server receives and stores it
    await route.abort('timedout'); // the browser never hears back
  });
}

const claims = async (sub: string) =>
  sql(`select c.id, c.status, c.receipt_sha256 from platform_payment_claims c join tenants t on t.id = c.tenant_id where t.subdomain = $1`, [sub]);

test('a lost answer, then "send" again with the same picture: one receipt, shown as sent', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('pcrty');
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  const pay = await openPay(page, c.sub);
  await pay.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG_A });
  await loseNextAnswer(page);
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(pay.getByRole('alert')).toContainText('Javob kelmadi');
  expect(await claims(c.sub)).toHaveLength(1);
  // The same send again: the key is kept, the server answers with that receipt.
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Chek yuborildi');
  expect(await claims(c.sub)).toHaveLength(1);
});

test('a lost answer, then another picture: not passed off as sent; the earlier receipt is the one being checked', async ({ page }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('pcrpl');
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  const pay = await openPay(page, c.sub);
  await pay.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG_A });
  await loseNextAnswer(page);
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(pay.getByRole('alert')).toContainText('Javob kelmadi');
  const [first] = await claims(c.sub);
  // The user picks another picture and sends: a new send, refused clearly.
  await pay.locator('input[type="file"]').setInputFiles({ name: 'boshqa.png', mimeType: 'image/png', buffer: PNG_B });
  await pay.getByRole('button', { name: 'Chekni yuborish' }).click();
  await expect(pay.getByRole('alert')).toContainText('allaqachon yetib kelgan');
  await expect(page.getByRole('dialog').getByRole('status')).toHaveCount(0);
  const after = await claims(c.sub);
  expect(after).toHaveLength(1);
  expect(after[0].receipt_sha256).toBe(first.receipt_sha256);
});

test('two tabs send at once: one receipt; the other tab says one is already being checked', async ({ page, context }) => {
  test.skip(TARGET !== 'local', 'needs the disposable local database');
  const c = await newCenter('pc2tb');
  await loginOnMainSite(page, c.email);
  await expectCenterDashboard(page, c.sub);
  const other = await context.newPage();
  const [a, b] = [await openPay(page, c.sub), await openPay(other, c.sub)];
  await a.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG_A });
  await b.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG_A });
  await Promise.all([a.getByRole('button', { name: 'Chekni yuborish' }).click(), b.getByRole('button', { name: 'Chekni yuborish' }).click()]);
  const sent = page.getByRole('dialog').getByRole('status').or(other.getByRole('dialog').getByRole('status'));
  await expect(sent.first()).toContainText('Chek yuborildi');
  const refused = a.getByRole('alert').or(b.getByRole('alert'));
  await expect(refused.first()).toContainText('allaqachon yetib kelgan');
  expect(await claims(c.sub)).toHaveLength(1);
});
