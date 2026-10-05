import { expect, test } from '@playwright/test';
import { PASSWORD, api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, run } from './support';

// Teaching: a teacher signs in, finds their group and takes attendance.
cleanUpStagingCenters();

// The browser 16 hours behind the center (Pago Pago, UTC-11; Tashkent,
// UTC+5), and its clock set to 03:00 UTC yesterday: 08:00 in Tashkent but
// 16:00 the day before in Pago Pago. The dates always differ, so a page
// that used the browser's date would record the wrong day. The lesson must
// be recorded on the center's day.
test.use({ timezoneId: 'Pacific/Pago_Pago' });

test("a teacher marks attendance for their own group, on the center's today", async ({ page }) => {
  const a = await newCenter('teaching');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Class Teacher', subject: 'Math' } });
  const email = `zzbr-teacher-class-${run}@example.test`;
  await api('POST', `/teachers/${teacher.id}/account`, { token: a.token, body: { email, password: PASSWORD } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Morning Math', subject: 'Math', teacherId: teacher.id, maxStudents: 10 } });
  const here = await api('POST', '/students', { token: a.token, body: { fullName: 'Present Pupil', groupIds: [group.id] } });
  const away = await api('POST', '/students', { token: a.token, body: { fullName: 'Absent Pupil', groupIds: [group.id] } });

  const now = new Date();
  const browserNow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 3, 0));
  await page.clock.setFixedTime(browserNow);
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
  const rows = await api<Array<{ studentId: string; status: string; date: string }>>('GET', `/attendance?groupId=${group.id}`, { token: a.token });
  expect(Object.fromEntries(rows.map((r) => [r.studentId, r.status]))).toEqual({ [here.id]: 'PRESENT', [away.id]: 'ABSENT' });
  expect(centerDay('Asia/Tashkent', browserNow)).not.toBe(centerDay('Pacific/Pago_Pago', browserNow));
  expect([...new Set(rows.map((r) => r.date))]).toEqual([centerDay('Asia/Tashkent', browserNow)]);
});
