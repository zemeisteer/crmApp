import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// Capacity: a full group takes no one else, and saying so is the page's job.
cleanUpStagingCenters();

test('a full group refuses another student and says why', async ({ page }) => {
  const a = await newCenter('capacity');
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'One seat', subject: 'English', monthlyPrice: 300000, maxStudents: 1 } });
  await api('POST', '/students', { token: a.token, body: { fullName: 'Seated Student', groupIds: [group.id] } });
  const waiting = await api('POST', '/students', { token: a.token, body: { fullName: 'Waiting Student' } });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, `/groups/${group.id}`));
  await expect(page.getByText('Seated Student').first()).toBeVisible();

  await page.getByRole('button', { name: "+ O'quvchi qo'shish" }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '— Tanlang —' }).click();
  await page.getByRole('option', { name: 'Waiting Student' }).click();
  await dialog.getByRole('button', { name: "Qo'shish", exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).toBeVisible();

  const detail = await api('GET', `/groups/${group.id}`, { token: a.token });
  const active = (detail.enrollments ?? []).filter((e: { status?: string }) => !e.status || e.status === 'ACTIVE');
  expect(active.map((e: { student: { id: string } }) => e.student.id)).not.toContain(waiting.id);
  expect(active).toHaveLength(1);
});
