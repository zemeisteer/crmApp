import { expect, test } from '@playwright/test';
import { addStaff, api, apiInFlight, apiStatuses, centerUrl, cleanUpStagingCenters, expectCenterDashboard, isApiUrl, loginOnMainSite, newCenter, run } from './support';

// Sessions: signing in through the main site, the handoff to the center's
// own address, logout, and a session ended from the server side.
// Every test gets its own browser context: no session leaks between them.
cleanUpStagingCenters();

test('sign in on the main site -> the center\'s own address -> reload keeps the session', async ({ page }) => {
  const a = await newCenter('login');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  // The one-time code is gone from the address bar.
  expect(page.url()).not.toContain('code=');
  await page.reload();
  await expectCenterDashboard(page, a.sub);
  // The main site kept no session of its own.
  const main = await page.context().newPage();
  await main.goto('/login?main=1');
  expect(await main.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('talimcrm_') && k !== 'talimcrm_last_center'))).toEqual([]);
});

test('logout: protected pages are refused afterwards', async ({ page }) => {
  const a = await newCenter('logout');
  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.locator('.sidebar').getByRole('button', { name: 'Chiqish' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  await page.goto(centerUrl(a.sub, '/payments'));
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  await expect(page.getByRole('button', { name: "+ Yangi to'lov" })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage.getItem('talimcrm_token'), localStorage.getItem('talimcrm_refresh')])).toEqual([null, null]);
});

test('staff removed while their browser is open: the next request is refused', async ({ page }) => {
  const a = await newCenter('removal');
  const email = `zzbr-staff-rm-${run}@example.test`;
  const staffId = await addStaff(a.token, email, 'ADMIN');
  const inFlight = apiInFlight(page);
  await loginOnMainSite(page, email);
  await expectCenterDashboard(page, a.sub);
  const studentsLoaded = page.waitForResponse((r) => isApiUrl(r.url()) && new URL(r.url()).pathname === '/api/students' && r.request().method() === 'GET');
  await page.locator('.sidebar').getByRole('link', { name: "O'quvchilar" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/students'));
  expect((await studentsLoaded).status()).toBe(200);
  // Everything the Students page asked for has been answered (it polls
  // nothing): no request of that page can be the one refused below, and the
  // menu stays in place for the click. This was the race that made the
  // test fail now and then: a slow Students request was refused first and
  // its redirect to /login detached the link being clicked.
  await expect.poll(inFlight, { message: 'API requests still in flight before the removal' }).toEqual([]);
  const statuses = apiStatuses(page);

  await api('DELETE', `/staff/${staffId}`, { token: a.token });

  await page.locator('.sidebar').getByRole('link', { name: 'Guruhlar' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/login'));
  expect(await page.evaluate(() => localStorage.getItem('talimcrm_token'))).toBeNull();
  // It was the Groups page's own request that was refused, and nothing after
  // the removal was answered with data.
  expect(statuses.length).toBeGreaterThan(0);
  expect(statuses[0]).toMatchObject({ status: 401 });
  expect(statuses.filter((s) => s.status < 400 && !s.path.endsWith('/auth/logout'))).toEqual([]);
});
