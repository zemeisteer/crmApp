import { expect, type Page, type Request } from '@playwright/test';
import { randomBytes } from 'crypto';

// Fixtures are prepared and final state is read through the API; the flow
// under test itself is always driven through the pages.
//
// Two targets:
//  - local (default): the disposable servers playwright.config.ts starts;
//  - staging (BROWSER_TARGET=staging, set by playwright.staging.config.ts):
//    an already deployed, CONFIRMED staging domain over HTTPS. Nothing is
//    reset there; the tests make their own "zzbr-" centers and delete them.
export const TARGET = process.env.BROWSER_TARGET === 'staging' ? 'staging' : 'local';
const ROOT = TARGET === 'staging' ? process.env.STAGING_ROOT! : 'localhost';
export const WEB_PORT = Number(process.env.BROWSER_WEB_PORT || 3300);
export const API = TARGET === 'staging' ? `https://${ROOT}/api` : `http://127.0.0.1:${process.env.BROWSER_API_PORT || 4300}/api`;
// The pages call the API as http://localhost:<port>/api (the build's
// NEXT_PUBLIC_API_URL); the tests themselves use 127.0.0.1. Either is the API.
export function isApiUrl(url: string) {
  if (TARGET === 'staging') return url.startsWith(API);
  const u = new URL(url);
  return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === new URL(API).port && u.pathname.startsWith('/api/');
}
export const centerUrl = (sub: string, path = '') =>
  TARGET === 'staging' ? `https://${sub}.${ROOT}${path}` : `http://${sub}.localhost:${WEB_PORT}${path}`;
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
// Every center a test made, so the staging run can delete exactly those.
const created: Array<{ token: string; sub: string }> = [];
export async function newCenter(tag: string) {
  const n = `${tag}-${run}-${++seq}`.toLowerCase();
  const email = `zzbr-owner-${n}@example.test`;
  const r = await api('POST', '/auth/register', { body: { centerName: `ZZ Browser ${n}`, subdomain: `zzbr-${n}`, email, password: PASSWORD, fullName: `Owner ${tag}` } });
  created.push({ token: r.accessToken, sub: r.tenant.subdomain });
  await api('POST', '/onboarding/complete', { token: r.accessToken });
  return { token: r.accessToken as string, tenantId: r.tenant.id as string, sub: r.tenant.subdomain as string, email };
}

/** Deletes the centers this run made (staging); returns what could not be deleted. */
export async function deleteOwnCenters(): Promise<string[]> {
  const left: string[] = [];
  for (const c of created.splice(0)) {
    if (!c.sub.startsWith('zzbr-')) continue;
    try {
      await api('DELETE', '/tenants/me', { token: c.token, body: { password: PASSWORD } });
    } catch {
      left.push(c.sub);
    }
  }
  return left;
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

/**
 * The current document's requests to the API that have not finished yet.
 * The pages poll nothing, so once every request a page started has finished,
 * nothing more reaches the API until the test acts. Tests that change
 * server state under an open page wait for that (an empty list) first, so no
 * request of the previous page can race the step under test.
 */
export function apiInFlight(page: Page) {
  const pending = new Set<Request>();
  page.on('request', (r) => {
    // A new document: the old one's requests are abandoned with it (the main
    // site's fire-and-forget logout after the handoff never reports back).
    if (r.isNavigationRequest() && r.frame() === page.mainFrame()) pending.clear();
    else if (isApiUrl(r.url())) pending.add(r);
  });
  page.on('requestfinished', (r) => pending.delete(r));
  page.on('requestfailed', (r) => pending.delete(r));
  return () => [...pending].map((r) => `${r.method()} ${new URL(r.url()).pathname} (${r.frame().url()})`);
}

/** Statuses of the API responses the page receives from now on, in order. */
export function apiStatuses(page: Page) {
  const seen: Array<{ path: string; status: number }> = [];
  page.on('response', (r) => {
    if (isApiUrl(r.url())) seen.push({ path: new URL(r.url()).pathname, status: r.status() });
  });
  return seen;
}
