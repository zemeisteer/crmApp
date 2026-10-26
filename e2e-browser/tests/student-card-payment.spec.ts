import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// A student pays the center by card transfer: the cabinet sends a receipt;
// the owner opens it under Payments -> card receipts, confirms one at the
// amount read on it (one payment, on the student's invoice) and rejects
// another with a reason; the cabinet shows both decisions.
cleanUpStagingCenters();

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test('a student sends card receipts; the center confirms one and rejects one; the cabinet shows each', async ({ page, browser }) => {
  const a = await newCenter('scard');
  await api('PUT', '/card-payments/card', { token: a.token, body: { cardNumber: '8600 1111 2222 3333', cardHolder: 'Test Markaz' } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Card Group', subject: 'English', monthlyPrice: 400_000, maxStudents: 10 } });
  const local = `94${String(Date.now()).slice(-7)}`;
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Card Kid Student', phone: `+998${local}`, groupIds: [group.id] } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });

  // --- The cabinet sends two receipts -----------------------------------------
  const ctx = await browser.newContext();
  const cab = await ctx.newPage();
  await cab.goto(centerUrl(a.sub, '/portal'));
  await cab.getByRole('textbox').first().pressSequentially(local);
  await cab.getByRole('button', { name: 'Davom etish' }).click();
  await cab.getByPlaceholder('••••••').fill(String(pin));
  await cab.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(cab.getByText('Card Kid Student').first()).toBeVisible();
  await cab.locator('.ptl-side').getByRole('button', { name: /^To'lovlar/ }).click();
  const transfer = cab.getByTestId('card-transfer');
  await expect(transfer).toContainText('8600 1111 2222 3333');
  for (const amount of ['250000', '120000']) {
    await transfer.getByLabel("O'tkazilgan summa (so'm)").fill(amount);
    await transfer.locator('input[type="file"]').setInputFiles({ name: 'chek.png', mimeType: 'image/png', buffer: PNG });
    await transfer.getByRole('button', { name: 'Chekni yuborish' }).click();
    await expect(transfer.getByRole('status')).toContainText('Chek yuborildi');
  }

  // --- The owner decides ----------------------------------------------------
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));
  await page.getByTestId('cards-tab').click();
  const claims = page.getByTestId('card-claims');
  await expect(claims.getByTestId('card-claim')).toHaveCount(2);
  await claims.getByTestId('card-claim').filter({ hasText: '250' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel("Kelgan summa (so'm)").fill('240000');
  await dlg.getByRole('button', { name: /Tasdiqlash: 240/ }).click();
  await expect(claims.getByTestId('card-claim')).toHaveCount(1);
  await claims.getByTestId('card-claim').first().click();
  await dlg.getByRole('button', { name: 'Rad etish' }).click();
  await dlg.getByLabel("Rad etish sababi (o'quvchi ko'radi)").fill("Chekda summa ko'rinmaydi");
  await dlg.getByRole('button', { name: 'Rad etish' }).click();
  await expect(claims.getByTestId('card-claim')).toHaveCount(0);

  // One payment, at the amount read on the receipt.
  const pays = await api<Array<{ amount: number; method: string }>>('GET', `/payments?studentId=${kid.id}`, { token: a.token });
  expect(pays.filter((p) => p.method === 'BANK_TRANSFER').map((p) => p.amount)).toEqual([240000]);

  // --- The cabinet sees both decisions ---------------------------------------
  await cab.reload();
  await cab.locator('.ptl-side').getByRole('button', { name: /^To'lovlar/ }).click();
  await expect(cab.getByTestId('card-transfer')).toContainText("Chekda summa ko'rinmaydi");
  await expect(cab.getByTestId('card-transfer')).toContainText('240');
  await ctx.close();
});
