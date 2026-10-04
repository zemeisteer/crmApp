import { expect, test } from '@playwright/test';
import { addStaff, api, apiLogin, centerMonth, centerUrl, cleanUpStagingCenters, money, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Payroll: an accountant pays a teacher's month in two parts from
// Reports -> Payroll. A double click and a retry after a lost reply each
// make one payout, and every payout is one expense.
cleanUpStagingCenters();

test('an accountant pays a month in installments, once each, with one expense each', async ({ page }) => {
  const a = await newCenter('payroll');
  const email = `zzbr-staff-acc-${run}@example.test`;
  await addStaff(a.token, email, 'ACCOUNTANT');
  const accountant = await apiLogin(email);
  await api('POST', '/teachers', { token: a.token, body: { fullName: 'Paid Teacher', subject: 'Math', salaryType: 'FIXED', salaryValue: 1000000 } });
  const month = centerMonth();

  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/reports?tab=payroll'));
  const row = page.getByRole('row').filter({ hasText: 'Paid Teacher' });
  await expect(row).toContainText(money(1000000));

  // 1. Part of the month, saved with a double click.
  await row.getByRole('button', { name: "To'lov qilish" }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton').fill('400000');
  await dialog.getByRole('button', { name: 'Maoshni tasdiqlash va Xarajatlarga yozish' }).dblclick();
  await expect(dialog).toHaveCount(0);
  await expect(row.getByText("Qisman to'langan")).toBeVisible();

  // 2. The rest; the reply to the first attempt is lost and the accountant
  //    presses the button again.
  let lost = 0;
  await page.route('**/api/salary-payments/disburse', async (route) => {
    if (lost === 0) {
      lost++;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });
  await row.getByRole('button', { name: "Qoldiqni to'lash" }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(money(400000)); // the earlier payout is listed
  await expect(dialog.getByRole('spinbutton')).toHaveValue('600000');
  const confirm = dialog.getByRole('button', { name: 'Maoshni tasdiqlash va Xarajatlarga yozish' });
  await confirm.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  expect(lost).toBe(1);
  await expect(row.getByText("✓ To'langan")).toBeVisible();

  const payouts = await api<Array<{ amount: number; expenseId: string | null }>>('GET', `/salary-payments?forMonth=${month}`, { token: accountant });
  expect(payouts.map((p) => p.amount).sort((x, y) => x - y)).toEqual([400000, 600000]);
  const expenses = await api<Array<{ id: string; category: string; amount: number }>>('GET', `/expenses?forMonth=${month}&category=SALARY`, { token: accountant });
  expect(payouts.every((p) => expenses.some((e) => e.id === p.expenseId))).toBe(true);
  expect(expenses).toHaveLength(2);
});
