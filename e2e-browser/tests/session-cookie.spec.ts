import { expect, test } from '@playwright/test';
import { centerUrl, expectCenterDashboard, loginOnMainSite, newCenter } from './support';

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
