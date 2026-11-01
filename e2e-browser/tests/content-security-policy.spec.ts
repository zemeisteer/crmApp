import { expect, test } from '@playwright/test';

// A policy that blocks the app's own scripts, styles or API calls would show
// here as a browser complaint, before any feature test failed in a stranger way.
test('pages carry the policy and the browser blocks nothing of ours', async ({ page }) => {
  const blocked: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) blocked.push(m.text());
  });
  const res = await page.goto('/login');
  const policy = res!.headers()['content-security-policy'];
  expect(policy).toContain("object-src 'none'");
  expect(policy).toContain('connect-src');
  await page.waitForLoadState('networkidle');
  for (const path of ['/', '/register', '/pricing', '/privacy']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(blocked).toEqual([]);
});
