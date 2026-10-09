import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { calendarConnections } from '../src/db/schema.js';
import { CalendarSyncService } from '../src/calendar/calendar-sync.service.js';
import { GOOGLE_CALENDAR_API, GoogleApiError, type GoogleCalendarApi, type GoogleEventBody } from '../src/calendar/google-calendar.api.js';

/**
 * A stand-in for Google (no network): calendars in memory, Google's rules
 * for client-chosen ids (a second insert of the same id is 409), and
 * failures on demand.
 */
class FakeGoogle implements GoogleCalendarApi {
  calendars = new Map<string, Map<string, GoogleEventBody & { id: string }>>([['primary', new Map()], ['work', new Map()]]);
  tokens = new Map<string, string>(); // refresh -> current access
  failNext: Array<{ op: string; err: GoogleApiError; afterApply?: boolean }> = [];
  calls: string[] = [];
  revoked: string[] = [];
  private n = 0;

  private maybeFail(op: string, beforeApply: boolean) {
    const i = this.failNext.findIndex((f) => f.op === op && !!f.afterApply !== beforeApply);
    if (i >= 0) throw this.failNext.splice(i, 1)[0].err;
  }
  authUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }) {
    return `https://accounts.example/auth?state=${p.state}&code_challenge=${p.codeChallenge}&client_id=${p.clientId}`;
  }
  async exchangeCode(code: string) {
    if (code !== 'good-code') throw new GoogleApiError('google 400 invalid_grant', 400, false, true);
    const refresh = `refresh-${++this.n}`;
    this.tokens.set(refresh, `access-${this.n}`);
    return { accessToken: `access-${this.n}`, refreshToken: refresh, expiresAt: new Date(Date.now() + 3600_000) };
  }
  async refresh(refreshToken: string) {
    this.maybeFail('refresh', true);
    if (!this.tokens.has(refreshToken)) throw new GoogleApiError('google 400 invalid_grant', 400, false, true);
    const a = `access-${++this.n}`;
    this.tokens.set(refreshToken, a);
    return { accessToken: a, expiresAt: new Date(Date.now() + 3600_000) };
  }
  async revoke(token: string) { this.revoked.push(token); this.tokens.delete(token); }
  async listCalendars() { return [{ id: 'primary', summary: 'Me', primary: true }, { id: 'work', summary: 'Work' }]; }
  async insertEvent(_t: string, cal: string, body: GoogleEventBody) {
    this.calls.push('insert');
    this.maybeFail('insert', true);
    const c = this.calendars.get(cal)!;
    if (body.id && c.has(body.id)) throw new GoogleApiError('google 409 duplicate', 409, false, false);
    const id = body.id ?? `g${++this.n}`;
    c.set(id, { ...body, id });
    this.maybeFail('insert', false);
    return { id };
  }
  async patchEvent(_t: string, cal: string, id: string, body: GoogleEventBody) {
    this.calls.push('patch');
    this.maybeFail('patch', true);
    const c = this.calendars.get(cal)!;
    if (!c.has(id)) throw new GoogleApiError('google 404', 404, false, false);
    c.set(id, { ...c.get(id)!, ...body, id });
    return { id };
  }
  async deleteEvent(_t: string, cal: string, id: string) {
    this.calls.push('delete');
    this.maybeFail('delete', true);
    this.calendars.get(cal)!.delete(id);
  }
  ours(cal = 'primary') {
    return [...this.calendars.get(cal)!.values()].filter((e) => e.extendedProperties?.private?.talimcrm === '1');
  }
}

describe('Calendar: subscriptions and Google sync (e2e)', () => {
  let app: NestExpressApplication;
  const google = new FakeGoogle();
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  const next = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i + weeks * 7));
    throw new Error('unreachable');
  };
  const prevEnv = { ...process.env };

  let ownerA: string, t1: string, t3: string, parent: string, ownerB: string, recA: string;
  let t1User: string, parentUser: string, recUser: string;
  let g1: string, s1: string, s1Phone: string, tch3: string;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `CAL ${key} ${suffix}`, subdomain: `cal-${key}-${suffix}`, email: `cal-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `cal-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  const ics = async (url: string, status = 200) => {
    const path = new URL(url).pathname;
    const res = await http().get(path).expect(status);
    return res.text as string;
  };

  beforeAll(async () => {
    Object.assign(process.env, {
      PUBLIC_API_URL: 'https://crm.example.uz/api',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'https://crm.example.uz/api/calendar/google/callback',
      CALENDAR_SYNC_MS: '0', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    ownerA = await register('a');
    const u1 = await invite(ownerA, 'TEACHER', 't1'); t1 = u1.token; t1User = u1.userId;
    const u3 = await invite(ownerA, 'TEACHER', 't3'); t3 = u3.token;
    const p = await invite(ownerA, 'PARENT', 'par'); parent = p.token; parentUser = p.userId;
    const rec = await invite(ownerA, 'RECEPTIONIST', 'rec'); recA = rec.token; recUser = rec.userId;
    const tch1 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'Cal T1', userId: u1.userId, subject: 'Math' }).expect(201)).body.id;
    tch3 = (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: 'Cal T3', userId: u3.userId, subject: 'Math' }).expect(201)).body.id;
    g1 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'Cal G1', subject: 'Math', teacherId: tch1, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:30', monthlyPrice: 777000 }).expect(201)).body.id;
    await (http().post('/api/groups').set(bearer(ownerA)).send({ name: 'Cal G2', subject: 'Math', teacherId: tch3, scheduleDays: 'Seshanba', startTime: '14:00', endTime: '15:00' }).expect(201));
    s1Phone = `+99895${String(suffix).slice(-7)}`;
    s1 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'Cal Student', phone: s1Phone, groupIds: [g1] }).expect(201)).body.id;
    await http().post(`/api/students/${s1}/guardians`).set(bearer(ownerA)).send({ userId: parentUser, relationship: 'Ona' }).expect(201);
    ownerB = await register('b');
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    for (const k of ['PUBLIC_API_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'CALENDAR_SYNC_MS', 'CALENDAR_TOKEN_KEY']) {
      if (prevEnv[k] === undefined) delete process.env[k];
      else process.env[k] = prevEnv[k];
    }
  });

  let t1Url: string;

  it("a teacher's link: their lessons only, UTC times, stable ids, no money or other students", async () => {
    const created = (await http().post('/api/calendar/feed').set(bearer(t1)).expect(201)).body;
    t1Url = created.url;
    expect(t1Url).toMatch(/^https:\/\/crm\.example\.uz\/api\/calendar\/feed\/[A-Za-z0-9_-]{43}\.ics$/);
    const current = (await http().get('/api/calendar/feed').set(bearer(t1)).expect(200)).body;
    expect(current.scope).toBe('TEACHER');
    expect(current.feed.tokenHint).toBe(created.tokenHint);
    expect(JSON.stringify(current)).not.toContain(t1Url.split('/').pop()!.slice(5)); // the key is not shown again
    const body = await ics(t1Url);
    const mon = next(1);
    expect(body).toContain(`UID:grp-${g1}-${mon}@crm.example.uz`);
    expect(body).toContain(`DTSTART:${mon.replace(/-/g, '')}T050000Z`); // 10:00 in Tashkent
    expect(body).toContain(`DTEND:${mon.replace(/-/g, '')}T063000Z`);
    expect(body).toContain('SUMMARY:Cal G1');
    expect(body).not.toContain('Cal G2'); // another teacher's group
    expect(body).not.toContain('Cal Student');
    expect(body).not.toContain('777');
    // Stable: the same events on a second fetch.
    expect((await ics(t1Url)).replace(/DTSTAMP:\d+T\d+Z/g, '')).toBe(body.replace(/DTSTAMP:\d+T\d+Z/g, ''));
  });

  it('a lesson called off stays in the calendar, marked cancelled, with the same id', async () => {
    const mon = next(1, 1);
    await http().post('/api/lessons/cancellations').set(bearer(ownerA)).send({ groupId: g1, date: mon }).expect(201);
    const body = await ics(t1Url);
    const block = body.split('BEGIN:VEVENT').find((b) => b.includes(`UID:grp-${g1}-${mon}@`))!;
    expect(block).toContain('STATUS:CANCELLED');
    // Moving the group's time keeps the ids; the times follow.
    await http().patch(`/api/groups/${g1}`).set(bearer(ownerA)).send({ startTime: '09:00', endTime: '10:30' }).expect(200);
    const moved = await ics(t1Url);
    expect(moved).toContain(`UID:grp-${g1}-${next(1)}@`);
    expect(moved).toContain(`DTSTART:${next(1).replace(/-/g, '')}T040000Z`);
  });

  it('a new link revokes the old one; revoking ends it; garbage keys are 404', async () => {
    const old = t1Url;
    t1Url = (await http().post('/api/calendar/feed').set(bearer(t1)).expect(201)).body.url;
    await ics(old, 404);
    await ics(t1Url, 200);
    await http().delete('/api/calendar/feed').set(bearer(t1)).expect(200);
    await ics(t1Url, 404);
    await http().get('/api/calendar/feed/short.ics').expect(404);
    await http().get(`/api/calendar/feed/${'x'.repeat(43)}.ics`).expect(404);
    t1Url = (await http().post('/api/calendar/feed').set(bearer(t1)).expect(201)).body.url;
  });

  it("make-ups appear once, in the student's and the session teacher's calendars, and show cancellation", async () => {
    // A cancelled lesson earns a credit; a session with T3 uses it.
    const mon = next(1, 1);
    const credit = (await http().post('/api/makeups/credits').set(bearer(ownerA)).send({ studentId: s1, groupId: g1, date: mon, reason: 'LESSON_CANCELLED' }).expect(201)).body.id;
    const wed = next(3);
    const b = (await http().post(`/api/makeups/credits/${credit}/book`).set(bearer(ownerA)).send({ mode: 'SESSION', date: wed, startTime: '16:00', endTime: '17:00', teacherId: tch3 }).expect(201)).body;
    const t3Url = (await http().post('/api/calendar/feed').set(bearer(t3)).expect(201)).body.url;
    const t3Body = await ics(t3Url);
    expect(t3Body.split(`UID:mk-${b.id}@`).length - 1).toBe(1);
    expect(t3Body).toContain('Cal Student'); // the teacher of the session sees whom it is for
    // The student's own calendar (from the cabinet).
    const { pin } = (await http().post(`/api/students/${s1}/portal-pin`).set(bearer(ownerA)).expect(201)).body;
    const cab = (await http().post('/api/portal/auth/phone/verify').send({ phone: s1Phone, pin }).expect(201)).body.accessToken;
    const sUrl = (await http().post('/api/portal/calendar/feed').set(bearer(cab)).expect(201)).body.url;
    const sBody = await ics(sUrl);
    expect(sBody.split(`UID:mk-${b.id}@`).length - 1).toBe(1);
    expect(sBody).toContain(`UID:grp-${g1}-${next(1)}@`);
    expect(sBody).not.toContain('Cal G2');
    // Cancelling the make-up: still listed once, cancelled.
    await http().post(`/api/makeups/bookings/${b.id}/cancel`).set(bearer(ownerA)).expect(201);
    const after = await ics(sUrl);
    expect(after.split('BEGIN:VEVENT').find((x) => x.includes(`UID:mk-${b.id}@`))).toContain('STATUS:CANCELLED');
    // A new PIN signs the cabinet out - and its calendar link with it.
    await http().post(`/api/students/${s1}/portal-pin`).set(bearer(ownerA)).expect(201);
    await ics(sUrl, 404);
  });

  it("a parent's link shows the linked child's lessons; unlinking removes them; removing a member ends the link", async () => {
    const pUrl = (await http().post('/api/calendar/feed').set(bearer(parent)).expect(201)).body.url;
    expect((await http().get('/api/calendar/feed').set(bearer(parent)).expect(200)).body.scope).toBe('PARENT');
    const body = await ics(pUrl);
    expect(body).toContain('Cal Student: Cal G1');
    await http().delete(`/api/students/${s1}/guardians/${parentUser}`).set(bearer(ownerA)).expect(200);
    expect(await ics(pUrl)).not.toContain('Cal G1');
    // A receptionist's (center) link stops when they are removed.
    const rUrl = (await http().post('/api/calendar/feed').set(bearer(recA)).expect(201)).body.url;
    expect(await ics(rUrl)).toContain('Cal G2');
    await http().delete(`/api/staff/${recUser}`).set(bearer(ownerA)).expect(200);
    await ics(rUrl, 404);
  });

  it("another center's people see nothing of this center", async () => {
    const bUrl = (await http().post('/api/calendar/feed').set(bearer(ownerB)).expect(201)).body.url;
    const body = await ics(bUrl);
    expect(body).not.toContain('Cal G1');
    expect(body).not.toContain('BEGIN:VEVENT');
    await http().get('/api/calendar/feed').expect(401);
  });

  // ---------------------------------------------------------------- Google

  let connectionId: string;
  const sync = () => app.get(CalendarSyncService).syncDue();
  const conn = async () => (await app.get<Database>(DB).select().from(calendarConnections).where(eq(calendarConnections.id, connectionId)))[0];
  const forceDue = () => app.get<Database>(DB).update(calendarConnections).set({ nextAttemptAt: null, syncRequestedAt: new Date() }).where(eq(calendarConnections.id, connectionId));

  it('connects through OAuth: one-time state, PKCE, identity from the state only', async () => {
    expect((await http().get('/api/calendar/google').set(bearer(t1)).expect(200)).body).toEqual({ configured: true, connection: null });
    const { url } = (await http().post('/api/calendar/google/connect').set(bearer(t1)).send({ returnTo: '/calendar' }).expect(201)).body;
    const state = new URL(url).searchParams.get('state')!;
    expect(new URL(url).searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // A forged state, a bad code, then the real one; the state cannot be reused.
    expect((await http().get('/api/calendar/google/callback?code=good-code&state=forged').expect(302)).headers.location).toContain('google=expired');
    const { url: url2 } = (await http().post('/api/calendar/google/connect').set(bearer(t1)).send({}).expect(201)).body;
    expect((await http().get(`/api/calendar/google/callback?code=bad&state=${new URL(url2).searchParams.get('state')}`).expect(302)).headers.location).toContain('google=error');
    const ok = await http().get(`/api/calendar/google/callback?code=good-code&state=${state}`).expect(302);
    expect(ok.headers.location).toContain('google=connected');
    expect((await http().get(`/api/calendar/google/callback?code=good-code&state=${state}`).expect(302)).headers.location).toContain('google=expired');
    const st = (await http().get('/api/calendar/google').set(bearer(t1)).expect(200)).body;
    expect(st.connection).toMatchObject({ status: 'ACTIVE', scope: 'TEACHER', calendarId: 'primary', pending: true });
    const rows = await app.get<Database>(DB).select().from(calendarConnections).where(eq(calendarConnections.userId, t1User));
    connectionId = rows[0].id;
    // Tokens are stored encrypted.
    expect(rows[0].accessTokenEnc).not.toContain('access-');
    expect(rows[0].refreshTokenEnc).not.toContain('refresh-');
    // Students and other centers cannot use it.
    expect((await http().get('/api/calendar/google').set(bearer(ownerB)).expect(200)).body.connection).toBeNull();
  });

  it("syncs the teacher's lessons once; a second run writes nothing", async () => {
    google.calendars.get('primary')!.set('their-own', { id: 'their-own', summary: 'Dentist', start: { dateTime: '2026-01-01T00:00:00Z' }, end: { dateTime: '2026-01-01T01:00:00Z' } });
    expect(await sync()).toBe(1);
    const events = google.ours();
    const mon = next(1);
    const lesson = events.find((e) => e.extendedProperties?.private?.key === `grp-${g1}-${mon}`)!;
    expect(lesson.summary).toBe('Cal G1 (Math)'); // the subject, when the name does not say it
    expect(lesson.start.dateTime).toBe(`${mon}T04:00:00.000Z`);
    // The cancelled Monday is not in Google.
    expect(events.find((e) => e.extendedProperties?.private?.key === `grp-${g1}-${next(1, 1)}`)).toBeUndefined();
    const count = events.length;
    google.calls = [];
    await forceDue();
    await sync();
    expect(google.calls).toEqual([]);
    expect(google.ours()).toHaveLength(count);
    expect((await conn()).syncRequestedAt).toBeNull();
  });

  it('an insert whose answer was lost is not duplicated on retry; failures back off', async () => {
    // Move the lesson: every event changes (patches). Then add a one-off lesson whose insert "times out" after Google applied it.
    await http().post('/api/schedule').set(bearer(ownerA)).send({ groupId: g1, date: next(5), startTime: '18:00', endTime: '19:00', isRecurring: false }).expect(201);
    google.failNext.push({ op: 'insert', err: new GoogleApiError('network: TimeoutError', 0, true, false), afterApply: true });
    await sync();
    let c = await conn();
    expect(c.attempts).toBe(1);
    expect(c.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(c.lastError).toContain('Timeout');
    expect(await sync()).toBe(0); // not due yet
    await forceDue();
    await sync();
    c = await conn();
    expect(c.attempts).toBe(0);
    expect(c.lastError).toBeNull();
    const oneOffs = google.ours().filter((e) => e.extendedProperties!.private.key.startsWith('one-'));
    expect(oneOffs).toHaveLength(1);
    // A rate limit backs off and grows.
    await http().patch(`/api/groups/${g1}`).set(bearer(ownerA)).send({ startTime: '09:30', endTime: '11:00' }).expect(200);
    google.failNext.push({ op: 'patch', err: new GoogleApiError('google 429', 429, true, false) });
    await sync();
    expect((await conn()).attempts).toBe(1);
    await app.get<Database>(DB).update(calendarConnections).set({ nextAttemptAt: null }).where(eq(calendarConnections.id, connectionId));
    google.failNext.push({ op: 'patch', err: new GoogleApiError('google 503', 503, true, false) });
    await sync();
    c = await conn();
    expect(c.attempts).toBe(2);
    expect(c.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(100_000); // 2 minutes
    await forceDue();
    await sync();
    expect(google.ours().find((e) => e.extendedProperties!.private.key === `grp-${g1}-${next(1)}`)!.start.dateTime).toBe(`${next(1)}T04:30:00.000Z`);
  });

  it('changes are recorded durably: a fresh server instance picks up what is pending', async () => {
    await http().post('/api/lessons/cancellations').set(bearer(ownerA)).send({ groupId: g1, date: next(1, 2) }).expect(201);
    expect((await conn()).syncRequestedAt).not.toBeNull(); // recorded before the answer
    // "Restart": a second application on the same database does the sync.
    const second = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    const app2 = second.createNestApplication<NestExpressApplication>();
    configureApp(app2);
    await app2.init();
    try {
      await app2.get(CalendarSyncService).syncDue();
    } finally {
      await app2.close();
    }
    expect(google.ours().find((e) => e.extendedProperties!.private.key === `grp-${g1}-${next(1, 2)}`)).toBeUndefined();
    expect((await conn()).syncRequestedAt).toBeNull();
  });

  it('moves the events when another calendar is chosen', async () => {
    const before = google.ours().length;
    expect((await http().get('/api/calendar/google/calendars').set(bearer(t1)).expect(200)).body.map((c: { id: string }) => c.id)).toEqual(['primary', 'work']);
    await http().patch('/api/calendar/google').set(bearer(t1)).send({ calendarId: 'someone-elses' }).expect(400);
    await http().patch('/api/calendar/google').set(bearer(t1)).send({ calendarId: 'work' }).expect(200);
    await sync();
    expect(google.ours('primary')).toHaveLength(0);
    expect(google.ours('work')).toHaveLength(before);
    expect(google.calendars.get('primary')!.has('their-own')).toBe(true);
  });

  it('a revoked grant asks the user to reconnect; disconnect removes only our events', async () => {
    const c = await conn();
    // Expire the access token, and make Google refuse the refresh.
    await app.get<Database>(DB).update(calendarConnections).set({ tokenExpiresAt: new Date(0), syncRequestedAt: new Date() }).where(eq(calendarConnections.id, c.id));
    google.failNext.push({ op: 'refresh', err: new GoogleApiError('google 400 invalid_grant', 400, false, true) });
    await sync();
    expect((await conn()).status).toBe('NEEDS_RECONNECT');
    expect((await http().post('/api/calendar/google/sync').set(bearer(t1)).expect(409)).body.code).toBe('NEEDS_RECONNECT');
    expect(await sync()).toBe(0); // never retried on its own
    // Disconnect: our events go (the refresh works again), the user's own event stays.
    google.calendars.get('work')!.set('meeting', { id: 'meeting', summary: 'Meeting', start: { dateTime: '2026-01-01T00:00:00Z' }, end: { dateTime: '2026-01-01T01:00:00Z' } });
    const res = (await http().delete('/api/calendar/google').set(bearer(t1)).expect(200)).body;
    expect(res.removedEvents).toBeGreaterThan(0);
    expect(google.ours('work')).toHaveLength(0);
    expect(google.calendars.get('work')!.has('meeting')).toBe(true);
    expect(google.revoked.length).toBe(1);
    expect((await http().get('/api/calendar/google').set(bearer(t1)).expect(200)).body.connection).toBeNull();
  });

  it('cabinet tokens and anonymous callers cannot reach the Google or staff routes', async () => {
    await http().get('/api/calendar/google').expect(401);
    await http().post('/api/calendar/google/connect').send({}).expect(401);
  });
});
