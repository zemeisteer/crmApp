import { expect, test } from '@playwright/test';
import { PASSWORD, api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Teaching: a teacher signs in, finds their group and takes attendance.
cleanUpStagingCenters();

test('a teacher marks attendance for their own group', async ({ page }) => {
  const a = await newCenter('teaching');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Class Teacher', subject: 'Math' } });
  const email = `zzbr-teacher-class-${run}@example.test`;
  await api('POST', `/teachers/${teacher.id}/account`, { token: a.token, body: { email, password: PASSWORD } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Morning Math', subject: 'Math', teacherId: teacher.id, maxStudents: 10 } });
  const here = await api('POST', '/students', { token: a.token, body: { fullName: 'Present Pupil', groupIds: [group.id] } });
  const away = await api('POST', '/students', { token: a.token, body: { fullName: 'Absent Pupil', groupIds: [group.id] } });

  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('link', { name: 'Guruhlar' }).click();
  await expect(page.getByRole('row')).toHaveCount(2); // the header and their one group
  await page.getByRole('row', { name: /Morning Math/ }).getByRole('link', { name: "Guruhni ko'rish" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, `/groups/${group.id}`));

  const row = page.locator('div').filter({ hasText: /^Absent Pupil/ }).filter({ has: page.getByRole('button', { name: "Yo'q" }) }).last();
  await row.getByRole('button', { name: "Yo'q" }).click();
  await page.getByRole('button', { name: 'Davomatni saqlash' }).click();
  await expect(page.getByRole('button', { name: 'Davomatni saqlash' })).toBeEnabled();

  await expect.poll(async () => (await api<Array<unknown>>('GET', `/attendance?groupId=${group.id}`, { token: a.token })).length).toBe(2);
  const rows = await api<Array<{ studentId: string; status: string }>>('GET', `/attendance?groupId=${group.id}`, { token: a.token });
  expect(Object.fromEntries(rows.map((r) => [r.studentId, r.status]))).toEqual({ [here.id]: 'PRESENT', [away.id]: 'ABSENT' });
});
