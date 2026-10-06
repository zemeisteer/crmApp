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

test('Escape closes an open list, not the form; a pasted phone keeps its digits', async ({ page }) => {
  const a = await newCenter('escape');
  await api('POST', '/groups', { token: a.token, body: { name: 'Escape group', subject: 'English', monthlyPrice: 300000, maxStudents: 5 } });
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/students'));
  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByRole('group', { name: "To'liq ism" }).getByRole('textbox');
  await name.fill('Typed Student');

  // The group list (multi-select), then a plain select: Escape closes each list only.
  await dialog.getByRole('group', { name: 'Guruh(lar)' }).getByRole('button').click();
  await expect(page.getByText(/^Escape group/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText(/^Escape group/)).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('group', { name: 'Jinsi' }).getByRole('button').click();
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(name).toHaveValue('Typed Student');

  // A full number pasted after the "+998 " the phone field shows on focus.
  const phone = dialog.getByRole('group', { name: 'Ota-ona telefoni' }).getByRole('textbox');
  await phone.click();
  await expect(phone).toHaveValue('+998 ');
  await page.keyboard.insertText('+998901234567');
  await expect(phone).toHaveValue('+998 90 123 45 67');

  // With no list open, Escape closes the form as before.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
