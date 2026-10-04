import { expect, test } from '@playwright/test';
import { addStaff, api, apiLogin, centerMonth, centerUrl, cleanUpStagingCenters, money, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Reports: the director's month view adds up what was recorded - money in
// from payments, money out from expenses, a payroll payout counted once.
cleanUpStagingCenters();

test("the director's report counts a payroll payout once", async ({ page }) => {
  const a = await newCenter('reports');
  const month = centerMonth();
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Report group', subject: 'English', monthlyPrice: 400000, maxStudents: 10 } });
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Report Student', groupIds: [group.id] } });
  await api('POST', '/payments', { token: a.token, body: { studentId: kid.id, amount: 400000, forMonth: month, method: 'CASH' } });
  const email = `zzbr-staff-rep-${run}@example.test`;
  await addStaff(a.token, email, 'ACCOUNTANT');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Report Teacher', salaryType: 'FIXED', salaryValue: 500000 } });
  await api('POST', '/salary-payments/disburse', { token: await apiLogin(email), body: { teacherId: teacher.id, amount: 150000, forMonth: month } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/reports'));
  // A tile: its label, its value, and a line under it.
  const tile = (label: string) => page.locator(`div:has(> div:text-is("${label}"))`).first();
  await expect(tile('Tushgan pul')).toContainText(money(400000));
  // Before payouts were linked to expenses, this read 300 000 (counted twice).
  await expect(tile('Sof foyda')).toContainText(money(250000));
  await expect(tile('Sof foyda')).toContainText('Xarajat:');
  await expect(tile('Sof foyda')).toContainText(money(150000));
});
