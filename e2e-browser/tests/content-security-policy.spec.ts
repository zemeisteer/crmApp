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
  for (const path of ['/', '/register', '/pricing', '/privacy', '/portal']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(blocked).toEqual([]);
});

test('scripts run only with the page nonce: an injected inline script is blocked', async ({ page }) => {
  const first = (await page.goto('/login'))!.headers()['content-security-policy'];
  const script = first.split('; ').find((d) => d.startsWith('script-src'))!;
  expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]{20,}'/);
  expect(script).not.toContain('unsafe-inline');
  // A new nonce for every page.
  const again = (await page.goto('/login'))!.headers()['content-security-policy'];
  expect(again).not.toBe(first);
  // The page itself works (its scripts carry the nonce): the sign-in form reacts.
  await expect(page.getByRole('button', { name: 'Kirish' })).toBeEnabled();

  // A script tag that reached the page's HTML (stored text shown as HTML): the
  // server's answer with one added, its policy unchanged.
  const violations: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) violations.push(m.text()); });
  await page.route('**/login', async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace('<body', '<body><script>window.__injected = true</script><span hidden');
    await route.fulfill({ response: res, body: html });
  });
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Kirish' })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected === true)).toBe(false);
  expect(violations.length).toBeGreaterThan(0);
});
