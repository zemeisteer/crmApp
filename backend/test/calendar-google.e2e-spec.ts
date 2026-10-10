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

type Stored = GoogleEventBody & { id: string };

/**
 * Google with accounts (no network). A code "acct:<name>" signs that account
 * in; every token belongs to one account and only reaches that account's
 * calendars ("primary" is the account's own). Failures on demand, and a gate
 * that holds an insert open so that something else can happen meanwhile.
 */
class FakeGoogleAccounts implements GoogleCalendarApi {
  accounts = new Map<string, Map<string, Map<string, Stored>>>();
  access = new Map<string, string>(); // access token -> account
  refreshTokens = new Map<string, string>(); // refresh token -> account
  failNext: Array<{ op: string; err: GoogleApiError }> = [];
  calls: Array<{ op: string; account: string; calendar?: string }> = [];
  revoked: string[] = [];
  /** When set, the next insert waits here (after Google has NOT yet applied it). */
  gate: { entered: () => void; release: Promise<void> } | null = null;
  private n = 0;

  private account(name: string) {
    if (!this.accounts.has(name)) this.accounts.set(name, new Map([[`${name}@gmail.test`, new Map()], [`work-${name}`, new Map()]]));
    return this.accounts.get(name)!;
  }
  private of(token: string) {
    const name = this.access.get(token);
    if (!name) throw new GoogleApiError('google 401 invalid token', 401, false, true);
    return name;
  }
  private calendar(token: string, cal: string) {
    const name = this.of(token);
    const c = this.account(name).get(cal === 'primary' ? `${name}@gmail.test` : cal);
    if (!c) throw new GoogleApiError('google 404 calendar', 404, false, false);
    return { name, c };
  }
  private maybeFail(op: string) {
    const i = this.failNext.findIndex((f) => f.op === op);
    if (i >= 0) throw this.failNext.splice(i, 1)[0].err;
  }
  authUrl(p: { state: string; codeChallenge: string; clientId: string }) {
    return `https://accounts.example/auth?state=${p.state}&code_challenge=${p.codeChallenge}&client_id=${p.clientId}`;
  }
  async exchangeCode(code: string) {
    if (!code.startsWith('acct:')) throw new GoogleApiError('google 400 invalid_grant', 400, false, true);
    const name = code.slice(5);
    this.account(name);
    const refresh = `refresh-${++this.n}`;
    const access = `access-${this.n}`;
    this.refreshTokens.set(refresh, name);
    this.access.set(access, name);
    return { accessToken: access, refreshToken: refresh, expiresAt: new Date(Date.now() + 3600_000) };
  }
  async refresh(refreshToken: string) {
    this.maybeFail('refresh');
    const name = this.refreshTokens.get(refreshToken);
    if (!name) throw new GoogleApiError('google 400 invalid_grant', 400, false, true);
    const access = `access-${++this.n}`;
    this.access.set(access, name);
    return { accessToken: access, expiresAt: new Date(Date.now() + 3600_000) };
  }
  /** The user withdrew the grant in their Google account. */
  kill(name: string) {
    for (const [k, v] of this.refreshTokens) if (v === name) this.refreshTokens.delete(k);
    for (const [k, v] of this.access) if (v === name) this.access.delete(k);
  }
  async revoke(token: string) {
    this.revoked.push(token);
    const name = this.refreshTokens.get(token);
    if (name) this.kill(name);
  }
  async listCalendars(token: string) {
    const name = this.of(token);
    return [{ id: `${name}@gmail.test`, summary: 'Me', primary: true }, { id: `work-${name}`, summary: 'Work' }];
  }
  async insertEvent(token: string, cal: string, body: GoogleEventBody) {
    const { name, c } = this.calendar(token, cal);
    if (this.gate) {
      const g = this.gate;
      this.gate = null;
      g.entered();
      await g.release;
    }
    this.calls.push({ op: 'insert', account: name, calendar: cal });
    this.maybeFail('insert');
    if (body.id && c.has(body.id)) throw new GoogleApiError('google 409 duplicate', 409, false, false);
    const id = body.id ?? `g${++this.n}`;
    c.set(id, { ...body, id });
    return { id };
  }
  async patchEvent(token: string, cal: string, id: string, body: GoogleEventBody) {
    const { name, c } = this.calendar(token, cal);
    this.calls.push({ op: 'patch', account: name, calendar: cal });
    this.maybeFail('patch');
    if (!c.has(id)) throw new GoogleApiError('google 404', 404, false, false);
    c.set(id, { ...c.get(id)!, ...body, id });
    return { id };
  }
  async deleteEvent(token: string, cal: string, id: string) {
    const { name, c } = this.calendar(token, cal);
    this.calls.push({ op: 'delete', account: name, calendar: cal });
    this.maybeFail('delete');
    c.delete(id);
  }
  /** Our events in an account (all its calendars, or one). */
  ours(name: string, cal?: string) {
    const out: Stored[] = [];
    for (const [id, c] of this.account(name)) {
      if (cal && id !== (cal === 'primary' ? `${name}@gmail.test` : cal)) continue;
      out.push(...[...c.values()].filter((e) => e.extendedProperties?.private?.talimcrm === '1'));
    }
    return out;
  }
}

// Google Calendar sync against the stand-in above. Nothing here reaches
// Google: a live check needs real credentials and a browser consent, and is
// reported separately.
describe('Google Calendar: reconnect, disconnect, races (e2e, mocked Google)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const google = new FakeGoogleAccounts();
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
  const prevDay = (date: string) => new Date(new Date(`${date}T00:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

  let owner: string, ownerId: string, group: string;
  const svc = () => app.get(CalendarSyncService);
  const row = async () => (await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ownerId)))[0];
  const forceDue = () => db.update(calendarConnections).set({ nextAttemptAt: null, lockedUntil: null, syncRequestedAt: new Date() }).where(eq(calendarConnections.userId, ownerId));
  const sync = async () => { await forceDue(); return svc().syncDue(); };
  const status = async () => (await http().get('/api/calendar/google').set(bearer(owner)).expect(200)).body.connection;
  const connect = async (account: string) => {
    const { url } = (await http().post('/api/calendar/google/connect').set(bearer(owner)).send({}).expect(201)).body;
    const res = await http().get(`/api/calendar/google/callback?code=acct:${account}&state=${new URL(url).searchParams.get('state')}`).expect(302);
    expect(res.headers.location).toContain('google=connected');
  };
  const key = (date: string, g = group) => `grp-${g}-${date}`;
  const eventOf = (account: string, k: string) => google.ours(account).find((e) => e.extendedProperties?.private?.key === k);

  beforeAll(async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'https://crm.example.uz/api/calendar/google/callback',
      CALENDAR_SYNC_MS: '0', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `GC ${suffix}`, subdomain: `gc-${suffix}`, email: `gc-${suffix}@test.uz`, password: 'password123', fullName: 'GC Owner' }).expect(201)).body;
    owner = reg.accessToken;
    ownerId = reg.user.id;
    // One weekly lesson that starts at midnight, Tashkent time.
    group = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'GC Night', subject: 'Math', scheduleDays: DAYS[3], startTime: '00:00', endTime: '01:00' }).expect(201)).body.id;
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('a lesson at midnight in Tashkent is the evening before in UTC; a second sync writes nothing', async () => {
    await connect('ali');
    expect(await sync()).toBe(1);
    const wed = next(3);
    const e = eventOf('ali', key(wed))!;
    // 00:00 on Wednesday at UTC+5 is 19:00 on Tuesday in UTC: the event keeps the instant, the link keeps the local date.
    expect(e.start.dateTime).toBe(`${prevDay(wed)}T19:00:00.000Z`);
    expect(e.end.dateTime).toBe(`${prevDay(wed)}T20:00:00.000Z`);
    const links = await svc().linksOf((await row()).id);
    expect(links.find((l) => l.eventKey === key(wed))!.date).toBe(wed);
    const before = google.ours('ali').length;
    google.calls = [];
    await sync();
    await sync();
    expect(google.calls).toEqual([]);
    expect(google.ours('ali')).toHaveLength(before);
  });

  it('a lesson called off is removed from Google; a lesson moved to another day is moved there', async () => {
    const wed = next(3, 1);
    await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: group, date: wed }).expect(201);
    await sync();
    expect(eventOf('ali', key(wed))).toBeUndefined();
    expect(eventOf('ali', key(next(3)))).toBeDefined();

    const total = google.ours('ali').length;
    const item = (await http().get(`/api/schedule?groupId=${group}`).set(bearer(owner)).expect(200)).body[0];
    await http().patch(`/api/schedule/${item.id}`).set(bearer(owner)).send({ dayOfWeek: 4 }).expect(200);
    await sync();
    expect(eventOf('ali', key(next(3)))).toBeUndefined();
    const thu = eventOf('ali', key(next(4)))!;
    expect(thu.start.dateTime).toBe(`${prevDay(next(4))}T19:00:00.000Z`);
    // Every Wednesday became a Thursday: none twice, none left behind.
    const keys = google.ours('ali').map((x) => x.extendedProperties!.private.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => dow(new Date(`${k.slice(-10)}T00:00:00Z`)) === 4)).toBe(true);
    expect(Math.abs(keys.length - total)).toBeLessThanOrEqual(2);
  });

  it('several workers at once never create an event twice', async () => {
    // A second server instance on the same database, with the same Google.
    const second = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    const app2 = second.createNestApplication<NestExpressApplication>();
    await app2.init();
    try {
      // A new lesson for everyone to write.
      const g2 = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'GC Day', subject: 'Math', scheduleDays: DAYS[1], startTime: '12:00', endTime: '13:00' }).expect(201)).body.id;
      await forceDue();
      google.calls = [];
      await Promise.all([svc().syncDue(), app2.get(CalendarSyncService).syncDue(), svc().syncDue(), app2.get(CalendarSyncService).syncDue()]);
      const mine = google.ours('ali').filter((e) => e.extendedProperties!.private.key.startsWith(`grp-${g2}-`));
      const inserts = google.calls.filter((c) => c.op === 'insert').length;
      expect(mine.length).toBeGreaterThan(0);
      // One insert per event, none refused as a duplicate, none patched over.
      expect(inserts).toBe(mine.length);
      expect(google.calls.filter((c) => c.op === 'patch')).toEqual([]);
      const keys = google.ours('ali').map((x) => x.extendedProperties!.private.key);
      expect(new Set(keys).size).toBe(keys.length);
    } finally {
      await app2.close();
    }
  }, 60_000);

  it('reconnecting the same Google account keeps the calendar the user chose, and the events', async () => {
    await http().patch('/api/calendar/google').set(bearer(owner)).send({ calendarId: 'work-ali' }).expect(200);
    await sync();
    const count = google.ours('ali', 'work-ali').length;
    expect(count).toBeGreaterThan(0);
    expect(google.ours('ali', 'primary')).toHaveLength(0);

    await connect('ali');
    expect(await status()).toMatchObject({ status: 'ACTIVE', calendarId: 'work-ali', calendarName: 'Work', leftoverEvents: 0 });
    google.calls = [];
    await sync();
    // Nothing recreated, nothing moved back to the primary calendar.
    expect(google.calls).toEqual([]);
    expect(google.ours('ali', 'work-ali')).toHaveLength(count);
    expect(google.ours('ali', 'primary')).toHaveLength(0);
  });

  it('another Google account starts clean: the old account is emptied with its own grant, and never touched with the new one', async () => {
    const before = google.ours('ali').length;
    expect(before).toBeGreaterThan(0);
    google.calls = [];
    await connect('vali');
    // The old account's events were deleted by the old account's token.
    expect(google.ours('ali')).toHaveLength(0);
    expect(google.calls.filter((c) => c.op === 'delete').every((c) => c.account === 'ali')).toBe(true);
    // The choice of calendar belonged to the old account.
    expect(await status()).toMatchObject({ status: 'ACTIVE', calendarId: 'primary', leftoverEvents: 0 });
    google.calls = [];
    await sync();
    expect(google.ours('vali', 'primary')).toHaveLength(before);
    expect(google.calls.every((c) => c.account === 'vali')).toBe(true);
    expect(google.ours('ali')).toHaveLength(0);
  });

  it('when the old account can no longer be reached, the user is told how many events stayed in it', async () => {
    const before = google.ours('vali').length;
    google.kill('vali'); // the grant was withdrawn in Google
    await connect('ali');
    const st = await status();
    expect(st).toMatchObject({ status: 'ACTIVE', calendarId: 'primary', leftoverEvents: before });
    // They are still there (we could not delete them), and are not ours to manage any more.
    expect(google.ours('vali')).toHaveLength(before);
    await sync();
    expect(google.ours('ali')).toHaveLength(before);
    await http().delete('/api/calendar/google/leftovers').set(bearer(owner)).expect(200);
    expect((await status()).leftoverEvents).toBe(0);
    expect((await status()).status).toBe('ACTIVE');
  });

  for (const [name, err] of [
    ['a rate limit (429)', new GoogleApiError('google 429 rateLimitExceeded', 429, true, false)],
    ['a server error (503)', new GoogleApiError('google 503', 503, true, false)],
    ['a timeout', new GoogleApiError('timeout', 0, true, false)],
  ] as const) {
    it(`disconnect interrupted by ${name}: what is left is kept, retried, and the grant is revoked only at the end`, async () => {
      if (!(await row())) { await connect('ali'); await sync(); }
      const total = google.ours('ali').length;
      expect(total).toBeGreaterThan(2);
      google.revoked = [];
      // The third delete fails.
      const realDelete = google.deleteEvent.bind(google);
      let n = 0;
      google.deleteEvent = async (...args: Parameters<typeof realDelete>) => { if (++n === 3) throw err; return realDelete(...args); };
      const res = (await http().delete('/api/calendar/google').set(bearer(owner)).expect(200)).body;
      google.deleteEvent = realDelete;
      expect(res).toEqual({ removedEvents: 2, notRemoved: 0, pending: total - 2 });
      // Not forgotten: the row, its links and its tokens are still there.
      const st = await status();
      expect(st).toMatchObject({ status: 'DISCONNECTING', cleanup: { events: total - 2 } });
      expect(st.nextAttemptAt).not.toBeNull();
      expect(st.lastError).toBeTruthy();
      expect(google.revoked).toEqual([]);
      expect(google.ours('ali')).toHaveLength(total - 2);
      // Not due yet: nothing happens, and nothing new is ever created for it.
      google.calls = [];
      await svc().syncDue();
      expect(google.calls).toEqual([]);
      // The retry time comes: the rest goes, then the grant, then the row.
      await db.update(calendarConnections).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(calendarConnections.userId, ownerId));
      await svc().syncDue();
      expect(google.calls.every((c) => c.op === 'delete')).toBe(true);
      expect(google.ours('ali')).toHaveLength(0);
      expect(google.revoked).toHaveLength(1);
      expect(await status()).toBeNull();
    });
  }

  it('disconnect when the grant is already gone: the events cannot be removed, and the user sees which', async () => {
    await connect('ali');
    await sync();
    const total = google.ours('ali').length;
    google.kill('ali');
    await db.update(calendarConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(calendarConnections.userId, ownerId));
    const res = (await http().delete('/api/calendar/google').set(bearer(owner)).expect(200)).body;
    expect(res).toEqual({ removedEvents: 0, notRemoved: total, pending: 0 });
    const st = await status();
    expect(st).toMatchObject({ status: 'CLEANUP_FAILED', cleanup: { events: total } });
    expect(st.cleanup.from <= st.cleanup.to).toBe(true);
    // The tokens are gone from the row; it is never synced again.
    const r = await row();
    expect(r.accessTokenEnc).toBeNull();
    expect(r.refreshTokenEnc).toBeNull();
    google.calls = [];
    await sync();
    expect(google.calls).toEqual([]);
    // "I have seen it" forgets the connection.
    expect((await http().delete('/api/calendar/google/leftovers').set(bearer(owner)).expect(200)).body.notRemoved).toBe(total);
    expect(await status()).toBeNull();
  });

  it('a disconnect that arrives in the middle of a sync: the worker stops, and nothing it wrote is left behind', async () => {
    await connect('sami');
    let entered!: () => void;
    let release!: () => void;
    const inInsert = new Promise<void>((r) => { entered = r; });
    google.gate = { entered, release: new Promise<void>((r) => { release = r; }) };
    await forceDue();
    google.calls = [];
    const running = svc().syncDue();
    await inInsert; // the worker is inside its first insert
    const res = (await http().delete('/api/calendar/google').set(bearer(owner)).expect(200)).body;
    // The worker holds the connection: the clean-up waits for it.
    expect(res).toMatchObject({ removedEvents: 0, notRemoved: 0 });
    expect((await status()).status).toBe('DISCONNECTING');
    release();
    await running;
    // Only the insert that was already under way went through.
    expect(google.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
    expect(google.ours('sami')).toHaveLength(1);
    // The clean-up finds that one too.
    await svc().syncDue();
    expect(google.ours('sami')).toHaveLength(0);
    expect(await status()).toBeNull();
  });

  it('a calendar switch in the middle of a sync: the worker stops writing to the calendar that was left', async () => {
    await connect('sami');
    let entered!: () => void;
    let release!: () => void;
    const inInsert = new Promise<void>((r) => { entered = r; });
    google.gate = { entered, release: new Promise<void>((r) => { release = r; }) };
    await forceDue();
    google.calls = [];
    const running = svc().syncDue();
    await inInsert;
    await http().patch('/api/calendar/google').set(bearer(owner)).send({ calendarId: 'work-sami' }).expect(200);
    release();
    await running;
    expect(google.calls.filter((c) => c.op === 'insert' && c.calendar === 'primary')).toHaveLength(1);
    // The next sync (the fresh row) puts everything in the chosen calendar and clears the old one.
    await sync();
    expect(google.ours('sami', 'primary')).toHaveLength(0);
    const keys = google.ours('sami', 'work-sami').map((x) => x.extendedProperties!.private.key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
    await http().delete('/api/calendar/google').set(bearer(owner)).expect(200);
    expect(google.ours('sami')).toHaveLength(0);
  });
});
