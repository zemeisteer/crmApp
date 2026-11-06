import { expect, test } from '@playwright/test';
import { authSlot, api, centerUrl, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

test('a session survives a reload with no token a script could read, and two tabs share it', async ({ page, context }) => {
  const a = await newCenter('cookie');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);

  const readable = () => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie);
  expect(await readable()).not.toMatch(/eyJ|talimcrm_refresh|talimcrm_token/);
  const cookie = (await context.cookies(centerUrl(a.sub, '/api/auth/refresh'))).find((c) => c.name === 'talimcrm_refresh');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

  await page.reload();
  await expectCenterDashboard(page, a.sub);

  // Two tabs opening at once both renew: refresh tokens rotate, so unserialized
  // renewals would end the session.
  const tabs = await Promise.all([context.newPage(), context.newPage(), context.newPage()]);
  await Promise.all(tabs.map((t) => t.goto(centerUrl(a.sub, '/dashboard'))));
  for (const t of tabs) await expectCenterDashboard(t, a.sub);
  await Promise.all([page.reload(), ...tabs.map((t) => t.reload())]);
  for (const t of [page, ...tabs]) await expectCenterDashboard(t, a.sub);
});

test('the cabinet keeps no token a script could read; an older page\'s token is adopted; signing out ends it', async ({ page, context }) => {
  const a = await newCenter('cabcookie');
  const digits = String(Date.now()).slice(-7);
  const kid = await api('POST', '/students', { token: a.token, body: { fullName: 'Cookie Child', phone: `+99893${digits}` } });
  const { pin } = await api('POST', `/students/${kid.id}/portal-pin`, { token: a.token });
  const readable = () => page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie);

  await page.goto(centerUrl(a.sub, '/portal'));
  await page.getByRole('textbox').first().pressSequentially(`93${digits}`);
  await authSlot('cabinet');
  await page.getByRole('button', { name: 'Davom etish' }).click();
  await page.getByPlaceholder('••••••').fill(String(pin));
  await page.getByRole('button', { name: 'Kabinetga kirish' }).click();
  await expect(page.getByText('Cookie Child').first()).toBeVisible();
  expect(await readable()).not.toMatch(/eyJ/);
  const cookie = (await context.cookies(centerUrl(a.sub, '/api/portal/me'))).find((c) => c.name === `talimcrm_cab_${kid.id}`);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

  await page.reload();
  await expect(page.getByText('Cookie Child').first()).toBeVisible();

  await page.getByRole('button', { name: 'Chiqish' }).first().click();
  await expect(page.getByRole('button', { name: 'Davom etish' })).toBeVisible();
  expect((await context.cookies(centerUrl(a.sub, '/api/portal/me'))).filter((c) => c.name.startsWith('talimcrm_cab_'))).toHaveLength(0);

  // A page from before this change left its token in storage: it opens, and the token leaves storage.
  const { accessToken } = await api('POST', '/portal/auth/phone/verify', { body: { phone: `+99893${digits}`, pin: String(pin) } });
  await page.evaluate((t) => localStorage.setItem('talimcrm_portal_token', t), accessToken);
  await page.reload();
  await expect(page.getByText('Cookie Child').first()).toBeVisible();
  expect(await readable()).not.toMatch(/eyJ/);
});
