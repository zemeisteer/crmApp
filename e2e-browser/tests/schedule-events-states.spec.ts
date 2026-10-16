import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

// The timetable's events: loading, none, a failed load (said so, with a retry
// - never shown as "no events") and a failed refresh (the earlier list stays,
// with a note that it may be out of date).
cleanUpStagingCenters();

test('timetable events: a failed load is not "no events"; a failed refresh keeps the list', async ({ page }) => {
  const a = await newCenter('evst');
  const tomorrow = new Date(Date.now() + 5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
  await api('POST', '/center-events', { token: a.token, body: { title: 'Ota-onalar majlisi', kind: 'MEETING', format: 'OFFLINE', date: tomorrow, startTime: '18:00', endTime: '19:00', location: 'Zal' } });

  let fail = true;
  await page.route('**/api/center-events?*', async (route) => {
    if (route.request().method() === 'GET' && fail) {
      const origin = route.request().headers()['origin'] ?? '*';
      return route.fulfill({ status: 503, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' }, body: JSON.stringify({ message: 'Server band' }) });
    }
    return route.continue();
  });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/schedule'));
  const section = page.locator('section[aria-labelledby="upcoming-events"]');

  // 1. The load fails: an error with a retry, not "no events".
  await expect(section.getByRole('alert')).toContainText("Tadbirlarni yuklab bo'lmadi");
  await expect(section.getByText("Yaqin orada tadbir yo'q")).toHaveCount(0);
  await expect(section.getByText('Ota-onalar majlisi')).toHaveCount(0);

  // 2. Retry once the server answers: the event is there, the error gone.
  fail = false;
  await section.getByRole('button', { name: 'Qayta urinish' }).click();
  await expect(section.getByText('Ota-onalar majlisi')).toBeVisible();
  await expect(section.getByRole('alert')).toHaveCount(0);

  // 3. A refresh that fails (after a save): the list loaded before stays, marked as maybe out of date.
  await section.getByRole('button', { name: /Ota-onalar majlisi/ }).click();
  const form = page.getByRole('dialog', { name: 'Tadbirni tahrirlash' });
  await form.getByLabel(/^Nomi/).fill("Ota-onalar yig'ilishi");
  fail = true;
  await form.getByRole('button', { name: 'Saqlash' }).click();
  await expect(form).toBeHidden();
  await expect(section.getByRole('alert')).toContainText('Tadbirlar yangilanmadi');
  await expect(section.getByText('Ota-onalar majlisi')).toBeVisible();

  // 4. Retry: the new title.
  fail = false;
  await section.getByRole('button', { name: 'Qayta urinish' }).click();
  await expect(section.getByText("Ota-onalar yig'ilishi")).toBeVisible();
  await expect(section.getByRole('alert')).toHaveCount(0);

  // 5. With no events at all the page says so (a different message from the error).
  const list = await api<Array<{ id: string }>>('GET', `/center-events?from=${tomorrow}&to=${tomorrow}`, { token: a.token });
  for (const ev of list) await api('DELETE', `/center-events/${ev.id}`, { token: a.token });
  await page.reload();
  await expect(section.getByText(/^Yaqin orada tadbir yo'q/)).toBeVisible();
  await expect(section.getByRole('alert')).toHaveCount(0);
  await expect(section.getByText('Ota-onalar')).toHaveCount(0);
});
