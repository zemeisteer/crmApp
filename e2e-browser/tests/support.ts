import { expect, test, type Locator, type Page, type Request } from '@playwright/test';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

/**
 * The API allows 8 sign-ups and 8 sign-ins a minute from one address
 * (auth.controller.ts) - here, on staging and in production alike. The
 * journeys need more than that in a minute, so they wait for a free slot
 * instead of being refused. The record is a file, so it survives a worker
 * restart after a failed test (the server's count does too).
 */
const AUTH_LIMIT = 7; // one below the server's 8, for clock skew
const AUTH_WINDOW_MS = 61_000;
const PACE_FILE = join(tmpdir(), `talimcrm-browser-auth-pace-${TARGET}.json`);
export async function authSlot(kind: 'register' | 'login') {
  for (;;) {
    const now = Date.now();
    let used: Record<string, number[]> = {};
    try {
      if (existsSync(PACE_FILE)) used = JSON.parse(readFileSync(PACE_FILE, 'utf8'));
    } catch {
      used = {};
    }
    const recent = (used[kind] ?? []).filter((t) => now - t < AUTH_WINDOW_MS).sort((x, y) => x - y);
    if (recent.length < AUTH_LIMIT) {
      used[kind] = [...recent, now];
      writeFileSync(PACE_FILE, JSON.stringify(used));
      return;
    }
    await new Promise((r) => setTimeout(r, recent[0] + AUTH_WINDOW_MS - now));
  }
}

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
  // The server takes subdomains of at most 30 characters ("zzbr-" + this):
  // the tag is shortened when the run id and a growing counter need the room.
  const tail = `-${run}-${++seq}`;
  const n = `${tag.slice(0, Math.max(1, 30 - 'zzbr-'.length - tail.length))}${tail}`.toLowerCase();
  const email = `zzbr-owner-${n}@example.test`;
  await authSlot('register');
  const r = await api('POST', '/auth/register', { body: { centerName: `ZZ Browser ${n}`, subdomain: `zzbr-${n}`, email, password: PASSWORD, fullName: `Owner ${tag}` } });
  created.push({ token: r.accessToken, sub: r.tenant.subdomain });
  await api('POST', '/onboarding/complete', { token: r.accessToken });
  return { token: r.accessToken as string, tenantId: r.tenant.id as string, sub: r.tenant.subdomain as string, email };
}

/**
 * Every journey file calls this once: on a deployed staging domain the
 * centers the file made are deleted when it ends.
 */
export function cleanUpStagingCenters() {
  test.afterAll(async () => {
    if (TARGET !== 'staging') return;
    const left = await deleteOwnCenters();
    if (left.length) console.warn(`not deleted (remove by hand): ${left.join(', ')}`);
  });
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
  await authSlot('login');
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

/** A token for a staff account of one center, through the API. */
export async function apiLogin(email: string): Promise<string> {
  await authSlot('login');
  return (await api('POST', '/auth/login', { body: { email, password: PASSWORD } })).accessToken;
}

/** The month (YYYY-MM) on a center's clock; centers default to Asia/Tashkent. */
export function centerMonth(tz = 'Asia/Tashkent', now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

/** Today (YYYY-MM-DD) on a center's clock. */
export function centerDay(tz = 'Asia/Tashkent', now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Wall-clock "YYYY-MM-DD HH:MM" of an instant in a timezone. */
export function wallClock(iso: string, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/**
 * Picks a date in the DatePicker inside `scope` (the one showing its
 * placeholder): year, then month, then day - never "today", so the result
 * does not depend on when the test runs.
 */
export async function pickDate(scope: Locator, year: number, month: number, day: number) {
  await scope.getByRole('button', { name: 'Sanani tanlang' }).click();
  const page = scope.page();
  await page.getByRole('button', { name: /^\d{4}\s*▾$/ }).click();
  await page.getByRole('button', { name: String(year), exact: true }).click();
  await page.getByRole('button', { name: /^\S+\s*▾$/ }).first().click();
  await page.getByRole('button', { name: UZ_MONTHS[month - 1], exact: true }).click();
  await page.getByRole('button', { name: String(day), exact: true }).click();
}

/** Picks hour and minute in the TimePicker inside `scope` showing `current`. */
export async function pickTime(scope: Locator, current: string, hour: string, minute: string) {
  await scope.getByRole('button', { name: current, exact: true }).click();
  const page = scope.page();
  await page.getByRole('button', { name: hour, exact: true }).click();
  await page.getByRole('button', { name: minute, exact: true }).last().click();
}

/**
 * An amount as the pages print it: grouped by thousands with whatever
 * separator the browser's locale data gives "uz-UZ" (a space, a no-break
 * space or a comma, depending on the browser build).
 */
export function money(n: number) {
  return new RegExp(`(^|[^\\d])${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '[\\s,.]?')}($|[^\\d])`);
}
