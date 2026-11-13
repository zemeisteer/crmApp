import { expect, test } from '@playwright/test';
import { api, centerUrl, cleanUpStagingCenters, newCenter } from './support';

// The center's public site: the application is two small steps (what to
// study, then name and phone); the parent's phone and a note stay behind a
// link. The lead reaches the center with the chosen course.
cleanUpStagingCenters();

test('the public site application: pick a course, then only name and phone', async ({ page }) => {
  const a = await newCenter('siteapply');
  await api('POST', '/groups', { token: a.token, body: { name: 'Site English', subject: 'Ingliz tili', monthlyPrice: 400000, maxStudents: 10 } });
  await page.goto(centerUrl(a.sub, '/'));

  const form = page.locator('#apply form');
  await form.scrollIntoViewIfNeeded();
  // Step 1: one question, no text fields.
  await expect(form.getByText('1-qadam')).toBeVisible();
  await expect(form.locator('input[type="text"]:visible, input[type="tel"]:visible, textarea:visible')).toHaveCount(0);
  await form.getByRole('button', { name: 'Ingliz tili' }).click();
  await expect(form.getByRole('button', { name: 'Ingliz tili' })).toHaveAttribute('aria-pressed', 'true');
  await form.getByRole('button', { name: /Davom etish/ }).click();

  // Step 2: name and phone only; the rest is behind a link.
  await expect(form.getByText('2-qadam')).toBeVisible();
  await expect(form.locator('input:visible:not([type="checkbox"]):not([tabindex="-1"])')).toHaveCount(2);
  await expect(form.locator('textarea')).toHaveCount(0);
  await form.getByPlaceholder('Masalan: Sardor Rustamov').fill('Sayt Mijoz');
  await form.getByRole('textbox').nth(1).pressSequentially('901234567');
  await form.getByRole('checkbox').check();
  // The server drops forms filled faster than a person can (under 2 s from the page opening).
  await page.waitForTimeout(2500);
  await form.getByRole('button', { name: /Arizani yuborish/ }).click();
  await expect(page.locator('#apply').getByText('✓')).toBeVisible();

  const leads = await api('GET', '/leads', { token: a.token });
  const list = Array.isArray(leads) ? leads : leads.items;
  const lead = list.find((l: { fullName: string }) => l.fullName === 'Sayt Mijoz');
  expect(lead).toBeTruthy();
  // The chosen course came with it (as the interest, however the list names it).
  expect(JSON.stringify(lead)).toContain('Ingliz tili');
});
