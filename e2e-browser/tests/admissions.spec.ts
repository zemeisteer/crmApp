import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter, pickDate, pickTime, wallClock } from './support';

// Admissions: a lead's follow-up and trial lesson are typed on the center's
// clock, whatever the browser's timezone; a new student survives a retry.
cleanUpStagingCenters();

// The center is on Asia/Tashkent (UTC+5); the browser is in New York
// (UTC-4/-5). Reading the inputs as the browser's time would be 9-10 hours off.
test.describe('a browser in another timezone', () => {
  test.use({ timezoneId: 'America/New_York' });

  test("a lead's follow-up and trial lesson are the center's local time", async ({ page }) => {
    const a = await newCenter('lead');
    const lead = await api('POST', '/leads', { token: a.token, body: { fullName: 'Clock Lead', phone: '+998901112233', source: 'PHONE' } });
    await api('POST', `/leads/${lead.id}/transition`, { token: a.token, body: { toStatus: 'CONTACTED' } });
    await loginOnMainSite(page, a.email);
    await expectCenterDashboard(page, a.sub);
    await page.goto(centerUrl(a.sub, `/leads/${lead.id}`));

    // Two years ahead: a fixed future date, whenever the test runs.
    const year = new Date().getFullYear() + 2;
    const setFollowUp = page.getByRole('button', { name: 'Qayta aloqani belgilash' });
    const followUp = page.locator('section').filter({ has: setFollowUp });
    await pickDate(followUp, year, 3, 20);
    await pickTime(followUp, '10:00', '14', '30');
    await expect(followUp.getByText('Vaqt markaz vaqtida: Asia/Tashkent')).toBeVisible();
    await setFollowUp.click();
    await expect.poll(async () => (await api('GET', `/leads/${lead.id}`, { token: a.token })).followUpAt).toBeTruthy();
    const withFollowUp = await api('GET', `/leads/${lead.id}`, { token: a.token });
    expect(wallClock(withFollowUp.followUpAt, 'Asia/Tashkent')).toBe(`${year}-03-20 14:30`);
    // Shown back as the center's time, not New York's.
    await expect(followUp.getByText(`20 mar ${year}, 14:30`)).toBeVisible();

    await page.getByRole('button', { name: 'Sinov darsi belgilash' }).first().click();
    const dialog = page.getByRole('dialog');
    await pickDate(dialog, year, 4, 15);
    await pickTime(dialog, '10:00', '09', '30');
    await dialog.getByRole('button', { name: 'Saqlash' }).click();
    await expect(dialog).toHaveCount(0);
    const booked = await api('GET', `/leads/${lead.id}`, { token: a.token });
    expect(booked.status).toBe('TRIAL_BOOKED');
    expect(booked.trials).toHaveLength(1);
    expect(wallClock(booked.trials[0].scheduledAt, 'Asia/Tashkent')).toBe(`${year}-04-15 09:30`);
    await expect(page.getByText(`15 apr ${year}, 09:30`)).toBeVisible();
  });
});
test('new student: a retry after a lost reply makes one student, with what was typed', async ({ page }) => {
  const a = await newCenter('student');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/students'));

  let lost = 0;
  await page.route('**/api/students', async (route) => {
    if (route.request().method() === 'POST' && lost === 0) {
      lost++;
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.fallback();
  });

  await page.getByRole('button', { name: "+ Yangi o'quvchi" }).click();
  const dialog = page.getByRole('dialog', { name: "Yangi o'quvchi" });
  await dialog.getByRole('group', { name: "To'liq ism" }).getByRole('textbox').fill('Retry Student');
  await dialog.getByRole('group', { name: 'Telefon', exact: true }).getByRole('textbox').pressSequentially('901234567');
  const save = dialog.getByRole('button', { name: "O'quvchini qo'shish" });
  await save.click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await save.click();
  await expect(dialog).toHaveCount(0);
  expect(lost).toBe(1);

  const list = await api<any>('GET', '/students', { token: a.token });
  const rows = (Array.isArray(list) ? list : list.items ?? list.data).filter((s: { fullName: string }) => s.fullName === 'Retry Student');
  expect(rows).toHaveLength(1);
  expect(rows[0].phone).toBe('+998 90 123 45 67');
});
