import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// A payment entered by mistake is taken back from the payments list, with a
// reason: it stays in the list as voided and the student owes it again.
cleanUpStagingCenters();

test('a payment entered by mistake is voided with a reason; the debt comes back', async ({ page }) => {
  const a = await newCenter('pvoid');
  const kid = await api<{ id: string }>('POST', '/students', { token: a.token, body: { fullName: 'Void Page Kid' } });
  const month = new Date().toISOString().slice(0, 7);
  const inv = await api<{ id: string }>('POST', '/invoices', { token: a.token, body: { studentId: kid.id, amount: 300_000, dueDate: `${month}-10`, forMonth: month } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 300_000, forMonth: month, method: 'BANK_TRANSFER', invoiceId: inv.id } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/payments'));
  page.once('dialog', (d) => void d.accept("Boshqa o'quvchiga yozilgan"));
  await page.getByRole('button', { name: 'Bekor qilish: Void Page Kid' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Void Page Kid' });
  await expect(row).toContainText('Bekor qilingan');
  await expect(row).toContainText("Boshqa o'quvchiga yozilgan");
  await expect(page.getByRole('button', { name: 'Bekor qilish: Void Page Kid' })).toHaveCount(0);

  const after = await api<{ remainingAmount: number; status: string }>('GET', `/invoices/${inv.id}`, { token: a.token });
  expect(after).toMatchObject({ remainingAmount: 300_000 });
});
