import { expect, test } from '@playwright/test';
import { PASSWORD, addStaff, api, apiLogin, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Role boundaries in the browser: what each role's menu offers and what
// the address bar cannot open.
cleanUpStagingCenters();

test('one person, two centers, a different role in each: switching from the menu', async ({ page }) => {
  const a = await newCenter('swa');
  const b = await newCenter('swb');
  const email = `zzbr-staff-sw-${run}@example.test`;
  await addStaff(a.token, email, 'ACCOUNTANT');
  await addStaff(b.token, email, 'TEACHER');

  await loginOnMainSite(page, email);
  await page.locator(`#workspace-${a.sub}`).click();
  await expectCenterDashboard(page, a.sub);
  const nav = page.locator('.sidebar');
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toBeVisible();

  await nav.getByRole('group', { name: 'Boshqa markazlarim' }).getByRole('button').click();
  await expectCenterDashboard(page, b.sub);
  // A teacher in B: no payments in the menu, and not through the address either.
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toHaveCount(0);
  await page.goto(centerUrl(b.sub, '/payments'));
  await expect(page.getByRole('alert').filter({ hasText: "Bu bo'lim sizning rolingiz uchun ochiq emas" })).toBeVisible();
});

test('a teacher sees only their own groups; finance and reports stay closed', async ({ page }) => {
  const a = await newCenter('roles');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Role Teacher', subject: 'Math' } });
  const email = `zzbr-teacher-roles-${run}@example.test`;
  await api('POST', `/teachers/${teacher.id}/account`, { token: a.token, body: { email, password: PASSWORD } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Own group', subject: 'Math', teacherId: teacher.id, maxStudents: 10 } });
  await api('POST', '/groups', { token: a.token, body: { name: 'Someone else group', subject: 'Math', maxStudents: 10 } });

  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  const nav = page.locator('.sidebar');
  await expect(nav.getByRole('link', { name: "To'lovlar" })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Hisobotlar' })).toHaveCount(0);

  await nav.getByRole('link', { name: 'Guruhlar' }).click();
  await expect(page.getByText('Own group')).toBeVisible();
  await expect(page.getByText('Someone else group')).toHaveCount(0);

  for (const path of ['/payments', '/reports', '/leads', '/settings']) {
    await page.goto(centerUrl(a.sub, path));
    await expect(page.getByRole('alert').filter({ hasText: "Bu bo'lim sizning rolingiz uchun ochiq emas" })).toBeVisible();
  }
  // The API agrees with the pages.
  const token = await apiLogin(email);
  await expect(api('GET', '/payments', { token })).rejects.toThrow(/403/);
  await expect(api('GET', '/salary-payments/calculate', { token })).rejects.toThrow(/403/);
});
