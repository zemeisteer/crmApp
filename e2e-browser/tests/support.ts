import { expect, type Page } from '@playwright/test';
import { randomBytes } from 'crypto';

// Fixtures are prepared and final state is read through the API; the flow
// under test itself is always driven through the pages.
export const API = `http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api`;
export const WEB_PORT = Number(process.env.BROWSER_WEB_PORT || 3300);
export const centerUrl = (sub: string, path = '') => `http://${sub}.localhost:${WEB_PORT}${path}`;
export const run = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
// Synthetic, generated per run, never printed.
export const PASSWORD = `Br-${randomBytes(6).toString('hex')}-9`;

export async function api<T = any>(method: string, path: string, opts: { token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

let seq = 0;
export async function newCenter(tag: string) {
  const n = `${tag}-${run}-${++seq}`.toLowerCase();
  const email = `owner-${n}@example.test`;
  const r = await api('POST', '/auth/register', { body: { centerName: `Browser ${n}`, subdomain: `br-${n}`, email, password: PASSWORD, fullName: `Owner ${tag}` } });
  await api('POST', '/onboarding/complete', { token: r.accessToken });
  return { token: r.accessToken as string, tenantId: r.tenant.id as string, sub: r.tenant.subdomain as string, email };
}

export async function addStaff(ownerToken: string, email: string, role: 'ADMIN' | 'ACCOUNTANT' | 'TEACHER') {
  await api('POST', '/staff', { token: ownerToken, body: { fullName: `Staff ${role}`, email, password: PASSWORD, role } });
  const list = await api<Array<{ id: string; email: string }>>('GET', '/staff', { token: ownerToken });
  return list.find((s) => s.email === email)!.id;
}

/** Signs in through the main site's login form. */
export async function loginOnMainSite(page: Page, email: string) {
  await page.goto('/login?main=1');
  await page.getByPlaceholder('azizbek@bilimdon.uz yoki +998901234567').fill(email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Kirish', exact: true }).click();
}

/** The dashboard of a center, on that center's own address. */
export async function expectCenterDashboard(page: Page, sub: string) {
  await expect(page).toHaveURL(centerUrl(sub, '/dashboard'));
  await expect(page.getByRole('heading', { name: /Xush kelibsiz/ })).toBeVisible();
}
