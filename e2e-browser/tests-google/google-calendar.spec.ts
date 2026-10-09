import { expect, test } from '@playwright/test';
import { api, centerDay, centerUrl, cleanUpStagingCenters, expectCenterDashboard, loginOnMainSite, newCenter } from '../tests/support';

// Google Calendar, connected, against the local fake Google that
// playwright.google.config.ts starts (scripts/fake-google.cjs): Connect goes
// through the (fake) consent screen and back to /calendar; a calendar is
// chosen; while Google is down the sync fails and says so, and "Sync now"
// after it is back writes the lessons at once (not after the backoff); a
// refused refresh (invalid_grant) asks to reconnect, and reconnecting
// works; disconnecting deletes our events at Google, revokes the grant and
// shows "not connected" again. Every step is checked at the fake too.
cleanUpStagingCenters();

const FAKE = `http://127.0.0.1:${process.env.BROWSER_FAKE_GOOGLE_PORT || 4399}`;
const LESSONS_CAL = 'lessons@group.calendar.example';

type Call = { op: string; status: number; calendarId?: string; eventId?: string; pkce?: boolean; challengeMethod?: string; clientId?: string; at: number };
type FakeEvent = { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string }; extendedProperties?: { private?: Record<string, string> } };
type FakeState = { calls: Call[]; revoked: string[]; calendars: Record<string, FakeEvent[]> };
type GoogleStatus = { configured: boolean; connection: null | { status: string; calendarId: string | null; calendarName: string | null; lastSyncAt: string | null; lastError: string | null; pending: boolean; nextAttemptAt: string | null } };

const fake = {
  state: async (): Promise<FakeState> => (await fetch(`${FAKE}/__fake/state`)).json(),
  mode: async (m: { refresh?: 'ok' | 'invalid_grant'; events?: 'ok' | 'down' }) => {
    const r = await fetch(`${FAKE}/__fake/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m) });
    expect(r.ok).toBe(true);
  },
  reset: async () => expect((await fetch(`${FAKE}/__fake/reset`, { method: 'POST' })).ok).toBe(true),
};
const ours = (s: FakeState, cal: string) => (s.calendars[cal] ?? []).filter((e) => e.extendedProperties?.private?.talimcrm === '1');
const allOurs = (s: FakeState) => Object.keys(s.calendars).flatMap((cal) => ours(s, cal));
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test('connect through the consent screen, choose a calendar, sync now, reconnect after a refused refresh, disconnect', async ({ page }) => {
  await fake.reset();
  const a = await newCenter('gcal');
  const teacher = await api('POST', '/teachers', { token: a.token, body: { fullName: 'Google Teacher', subject: 'English' } });
  const group = await api('POST', '/groups', { token: a.token, body: { name: 'Google Group', subject: 'English', teacherId: teacher.id, scheduleDays: 'Dushanba,Payshanba', startTime: '10:00', endTime: '11:30', maxStudents: 10 } });
  // The sync writes the owner's (whole center's) lessons of the past week and the next 60 days.
  const today = centerDay();
  const lessons = await api<Array<{ date: string; cancelled: boolean }>>('GET', `/lessons?from=${addDays(today, -7)}&to=${addDays(today, 60)}&groupId=${group.id}`, { token: a.token });
  const expected = lessons.filter((l) => !l.cancelled).length;
  expect(expected).toBeGreaterThan(10);
  const status = () => api<GoogleStatus>('GET', '/calendar/google', { token: a.token });

  await loginOnMainSite(page, a.email);
  await expectCenterDashboard(page, a.sub);
  await page.goto(centerUrl(a.sub, '/calendar'));
  const google = page.getByRole('region', { name: 'Google Calendar' });
  await expect(google).toContainText('Google hisobi ulanmagan.');

  // --- Connect: the fake consent screen sends the browser straight back -------
  // Google is "down" for event writes at first: the first syncs fail.
  await fake.mode({ events: 'down' });
  await google.getByRole('button', { name: "Google Calendar'ni ulash" }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/calendar'));
  await expect(page.getByRole('status').filter({ hasText: 'Google Calendar ulandi.' })).toBeVisible();
  await expect(google).toContainText('Ulangan');
  await expect(google).toContainText('Markazning barcha darslari');
  await expect(google).toContainText('Asosiy kalendar');
  let s = await fake.state();
  expect(s.calls.find((c) => c.op === 'authorize')).toMatchObject({ status: 302, clientId: 'browser-test-client', challengeMethod: 'S256' });
  // The code was exchanged with the PKCE verifier that matches the challenge.
  expect(s.calls.find((c) => c.op === 'token:authorization_code')).toMatchObject({ status: 200, pkce: true });
  expect((await status()).connection).toMatchObject({ status: 'ACTIVE', calendarId: 'primary' });

  // The first sync (into the primary calendar) fails while Google is down, and backs off.
  await expect.poll(async () => (await status()).connection?.lastError ?? '', { timeout: 20_000 }).toContain('503');
  s = await fake.state();
  expect(s.calls.some((c) => c.op === 'insert' && c.status === 503 && c.calendarId === 'primary')).toBe(true);
  expect(allOurs(s)).toHaveLength(0);

  // --- Choose a calendar ------------------------------------------------------
  await google.getByRole('button', { name: 'Kalendarni tanlash' }).click();
  await google.getByRole('button', { name: 'Google kalendari', exact: true }).click();
  await page.getByRole('option', { name: 'Darslar' }).click();
  await expect(google.getByRole('status')).toHaveText("Kalendar tanlandi: darslar keyingi sinxronlashda ko'chiriladi.");
  expect((await fake.state()).calls.some((c) => c.op === 'calendarList' && c.status === 200)).toBe(true);
  expect((await status()).connection).toMatchObject({ calendarId: LESSONS_CAL, calendarName: 'Darslar' });
  // Choosing asks for a sync, which fails too (still down) and backs off for a minute.
  await expect.poll(async () => (await fake.state()).calls.some((c) => c.op === 'insert' && c.status === 503 && c.calendarId === LESSONS_CAL), { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => (await status()).connection?.nextAttemptAt ?? null, { timeout: 20_000 }).not.toBeNull();
  await page.reload();
  await expect(google).toContainText('Darslar');
  await expect(google).toContainText('Oxirgi xato: google 503');
  await expect(google).toContainText('keyingi urinish:');

  // --- Google is back; "Sync now" writes the lessons at once ----------------------
  await fake.mode({ events: 'ok' });
  await google.getByRole('button', { name: 'Hozir sinxronlash' }).click();
  await expect(google.getByRole('status')).toContainText("Sinxronlash navbatga qo'yildi");
  // Well within the minute the backoff would otherwise wait.
  await expect.poll(async () => ours(await fake.state(), LESSONS_CAL).length, { timeout: 20_000 }).toBe(expected);
  s = await fake.state();
  expect(ours(s, 'primary')).toHaveLength(0);
  for (const e of ours(s, LESSONS_CAL)) expect(e.summary).toContain('Google Group');
  // Every write used a fresh access token from the refresh grant (the fake's tokens live 30 s).
  expect(s.calls.some((c) => c.op === 'token:refresh_token' && c.status === 200)).toBe(true);
  await expect.poll(async () => (await status()).connection?.lastSyncAt ?? null, { timeout: 10_000 }).not.toBeNull();
  await page.reload();
  await expect(google).not.toContainText('Oxirgi xato');
  await expect(google).not.toContainText("Hali bo'lmagan");

  // --- Google refuses the refresh (revoked at Google): reconnect is asked for -------
  await fake.mode({ refresh: 'invalid_grant' });
  await google.getByRole('button', { name: 'Hozir sinxronlash' }).click();
  await expect.poll(async () => (await status()).connection?.status, { timeout: 20_000 }).toBe('NEEDS_RECONNECT');
  await page.reload();
  await expect(google.getByRole('alert')).toContainText('qayta ulang');
  await expect(google).toContainText('Qayta ulash kerak');
  await expect(google.getByRole('button', { name: 'Hozir sinxronlash' })).toHaveCount(0);

  // Reconnecting goes through the consent screen again and is active at once.
  await fake.mode({ refresh: 'ok' });
  await google.getByRole('button', { name: 'Qayta ulash' }).click();
  await expect(page).toHaveURL(centerUrl(a.sub, '/calendar'));
  await expect(page.getByRole('status').filter({ hasText: 'Google Calendar ulandi.' })).toBeVisible();
  await expect(google).toContainText('Ulangan');
  await expect(google.getByRole('alert')).toHaveCount(0);
  // Its sync (asked for by the reconnect) settles: each lesson once at Google, nothing duplicated.
  await expect.poll(async () => {
    const c = (await status()).connection;
    return !!c && c.status === 'ACTIVE' && !c.pending && !c.lastError && allOurs(await fake.state()).length === expected;
  }, { timeout: 20_000 }).toBe(true);

  // --- Disconnect: our events are deleted at Google, the grant revoked ---------------
  const before = await fake.state();
  page.once('dialog', (d) => d.accept());
  await google.getByRole('button', { name: 'Uzish' }).click();
  await expect(google.getByRole('status')).toHaveText(`Uzildi. Google kalendaridan ${expected} ta voqea o'chirildi.`);
  await expect(google).toContainText('Google hisobi ulanmagan.');
  await expect(google.getByRole('button', { name: "Google Calendar'ni ulash" })).toBeVisible();
  s = await fake.state();
  expect(allOurs(s)).toHaveLength(0);
  const deletes = s.calls.slice(before.calls.length).filter((c) => c.op === 'delete');
  expect(deletes).toHaveLength(expected);
  expect(deletes.every((c) => c.status === 204)).toBe(true);
  expect(s.calls.slice(before.calls.length).some((c) => c.op === 'revoke')).toBe(true);
  expect((await status()).connection).toBeNull();
  await page.reload();
  await expect(google).toContainText('Google hisobi ulanmagan.');
});
