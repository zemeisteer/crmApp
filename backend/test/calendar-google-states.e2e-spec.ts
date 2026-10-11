import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { CalendarSyncService } from '../src/calendar/calendar-sync.service.js';
import { GOOGLE_CALENDAR_API, GoogleApiError, type GoogleCalendarApi, type GoogleEventBody } from '../src/calendar/google-calendar.api.js';
import { DB, Database } from '../src/db/db.module.js';
import { calendarConnections, calendarEventLinks } from '../src/db/schema.js';

type Stored = GoogleEventBody & { id: string };
type Cal = { id: string; summary: string; primary?: boolean };

/**
 * A stand-in for Google with accounts (as in calendar-google.e2e-spec.ts),
 * plus what these tests need: the calendar list can fail or come back
 * empty, and any call can be held at a gate while something else happens.
 * Nothing here reaches Google.
 */
class FakeGoogle implements GoogleCalendarApi {
  accounts = new Map<string, Map<string, Map<string, Stored>>>();
  access = new Map<string, string>();
  refreshTokens = new Map<string, string>();
  failNext: Array<{ op: string; err: GoogleApiError }> = [];
  /** What the calendar list answers next time(s), instead of the account's calendars. */
  listAnswers: Array<(real: Cal[]) => Cal[]> = [];
  calls: Array<{ op: string; account: string }> = [];
  revoked: string[] = [];
  gates: Array<{ op: string; entered: () => void; release: Promise<void> }> = [];
  private n = 0;

  /** The next call of this kind stops before Google applies it, until released. */
  hold(op: string) {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((r) => { entered = r; });
    this.gates.push({ op, entered, release: new Promise<void>((r) => { release = r; }) });
    return { reached, release };
  }
  private async gate(op: string) {
    const i = this.gates.findIndex((g) => g.op === op);
    if (i < 0) return;
    const [g] = this.gates.splice(i, 1);
    g.entered();
    await g.release;
  }
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
    this.calls.push({ op: 'list', account: name });
    this.maybeFail('list');
    const real: Cal[] = [{ id: `${name}@gmail.test`, summary: 'Me', primary: true }, { id: `work-${name}`, summary: 'Work' }];
    const answer = this.listAnswers.shift();
    return answer ? answer(real) : real;
  }
  async insertEvent(token: string, cal: string, body: GoogleEventBody) {
    const { name, c } = this.calendar(token, cal);
    await this.gate('insert');
    this.calls.push({ op: 'insert', account: name });
    this.maybeFail('insert');
    if (body.id && c.has(body.id)) throw new GoogleApiError('google 409 duplicate', 409, false, false);
    const id = body.id ?? `g${++this.n}`;
    c.set(id, { ...body, id });
    return { id };
  }
  async patchEvent(token: string, cal: string, id: string, body: GoogleEventBody) {
    const { name, c } = this.calendar(token, cal);
    this.calls.push({ op: 'patch', account: name });
    this.maybeFail('patch');
    if (!c.has(id)) throw new GoogleApiError('google 404', 404, false, false);
    c.set(id, { ...c.get(id)!, ...body, id });
    return { id };
  }
  async deleteEvent(token: string, cal: string, id: string) {
    const { name, c } = this.calendar(token, cal);
    await this.gate('delete');
    this.calls.push({ op: 'delete', account: name });
    this.maybeFail('delete');
    c.delete(id);
  }
  ours(name: string, cal?: string) {
    const out: Stored[] = [];
    for (const [id, c] of this.account(name)) {
      if (cal && id !== (cal === 'primary' ? `${name}@gmail.test` : cal)) continue;
      out.push(...[...c.values()].filter((e) => e.extendedProperties?.private?.talimcrm === '1'));
    }
    return out;
  }
  wipe() {
    this.accounts.clear();
    this.failNext = [];
    this.listAnswers = [];
    this.gates = [];
    this.calls = [];
    this.revoked = [];
  }
}

// What happens to a Google Calendar connection when Google does not say
// whose account it is, when the account changes, and when two workers or two
// callbacks meet. Mocked Google only: a live check needs real credentials
// and a browser consent, and is reported separately.
describe('Google Calendar: account identity and worker ownership (e2e, mocked Google)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const google = new FakeGoogle();
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

  let owner: string, ownerId: string;
  // Only this suite's centers: other suites run at the same time on the same database, with a Google of their own.
  let ownCenters: string[] = [];
  const svc = () => app.get(CalendarSyncService);
  const row = async () => (await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ownerId)))[0];
  const links = async () => { const r = await row(); return r ? db.select().from(calendarEventLinks).where(eq(calendarEventLinks.connectionId, r.id)) : []; };
  const forceDue = () => db.update(calendarConnections).set({ nextAttemptAt: null, lockedUntil: null, lockToken: null, syncRequestedAt: new Date() }).where(eq(calendarConnections.userId, ownerId));
  const sync = async () => { await forceDue(); return svc().syncDue(10, ownCenters); };
  const status = async () => (await http().get('/api/calendar/google').set(bearer(owner)).expect(200)).body.connection;
  const callback = async (account: string) => {
    const { url } = (await http().post('/api/calendar/google/connect').set(bearer(owner)).send({}).expect(201)).body;
    const res = await http().get(`/api/calendar/google/callback?code=acct:${account}&state=${new URL(url).searchParams.get('state')}`).expect(302);
    return new URL(res.headers.location).searchParams.get('google');
  };
  const keys = (account: string, cal?: string) => google.ours(account, cal).map((e) => e.extendedProperties!.private.key).sort();
  /** From nothing: no connection, empty Google. */
  const reset = async () => {
    await db.delete(calendarConnections).where(eq(calendarConnections.userId, ownerId));
    google.wipe();
  };
  /** Connected as ali with events written into the chosen calendar. */
  const connected = async (calendar: 'primary' | 'work-ali' = 'work-ali') => {
    await reset();
    expect(await callback('ali')).toBe('connected');
    if (calendar !== 'primary') await http().patch('/api/calendar/google').set(bearer(owner)).send({ calendarId: calendar }).expect(200);
    await sync();
    const mine = keys('ali', calendar);
    expect(mine.length).toBeGreaterThan(2);
    google.calls = [];
    return mine;
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'https://crm.example.uz/api/calendar/google/callback',
      CALENDAR_SYNC_MS: '0', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'),
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `GS ${suffix}`, subdomain: `gs-${suffix}`, email: `gs-${suffix}@test.uz`, password: 'password123', fullName: 'GS Owner' }).expect(201)).body;
    owner = reg.accessToken;
    ownerId = reg.user.id;
    ownCenters = [reg.tenant.id];
    await http().post('/api/groups').set(bearer(owner)).send({ name: 'GS Daily', subject: 'Math', scheduleDays: `${DAYS[2]},${DAYS[4]}`, startTime: '10:00', endTime: '11:00' }).expect(201);
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  // ---- whose account ---------------------------------------------------------

  describe('the account is not known: nothing is changed', () => {
    const cases: Array<[string, () => void]> = [
      ['a rate limit (429)', () => google.failNext.push({ op: 'list', err: new GoogleApiError('google 429', 429, true, false) })],
      ['a server error (500)', () => google.failNext.push({ op: 'list', err: new GoogleApiError('google 500', 500, true, false) })],
      ['a timeout', () => google.failNext.push({ op: 'list', err: new GoogleApiError('network: TimeoutError', 0, true, false) })],
      ['an empty calendar list', () => google.listAnswers.push(() => [])],
      ['no primary calendar in the list', () => google.listAnswers.push((real) => real.filter((c) => !c.primary))],
    ];
    for (const account of ['ali', 'bob']) {
      for (const [name, arrange] of cases) {
        it(`${name}, signing in as ${account === 'ali' ? 'the same' : 'another'} account`, async () => {
          const mine = await connected('work-ali');
          const before = await row();
          const linked = (await links()).length;
          arrange();
          expect(await callback(account)).toBe('unverified');
          const after = await row();
          // The same calendar, the same grant, the same events; nothing revoked, nothing deleted.
          expect(after).toMatchObject({
            status: 'ACTIVE', calendarId: 'work-ali', accountKey: before.accountKey, epoch: before.epoch,
            accessTokenEnc: before.accessTokenEnc, refreshTokenEnc: before.refreshTokenEnc, nextRefreshTokenEnc: null,
          });
          expect(keys('ali', 'work-ali')).toEqual(mine);
          expect((await links()).length).toBe(linked);
          expect(google.revoked).toEqual([]);
          expect(google.calls.filter((c) => c.op !== 'list')).toEqual([]);
          expect(google.ours('bob')).toEqual([]);
          // And it still works.
          await sync();
          expect((await row()).lastError).toBeNull();
          expect(keys('ali', 'work-ali')).toEqual(mine);
        });
      }
    }

    it('with no connection yet, an unknown account connects and learns nothing to harm; the next sign-in is compared through the old grant', async () => {
      await reset();
      google.failNext.push({ op: 'list', err: new GoogleApiError('google 503', 503, true, false) });
      expect(await callback('ali')).toBe('connected');
      expect(await row()).toMatchObject({ status: 'ACTIVE', accountKey: null, calendarId: 'primary' });
      await sync();
      const mine = keys('ali', 'primary');
      expect(mine.length).toBeGreaterThan(2);
      // The same account again, now with an answer: confirmed through the old grant, everything stays.
      expect(await callback('ali')).toBe('connected');
      expect((await row()).accountKey).toMatch(/^[0-9a-f]{64}$/);
      expect((await links()).length).toBe(mine.length);
      expect(keys('ali', 'primary')).toEqual(mine);
    });
  });

  describe('connections from before accounts were recorded', () => {
    const forgetAccount = () => db.update(calendarConnections).set({ accountKey: null }).where(eq(calendarConnections.userId, ownerId));

    it('a calendar of its own that the new grant has too: the same account, nothing asked of the old grant', async () => {
      const mine = await connected('work-ali');
      await forgetAccount();
      expect(await callback('ali')).toBe('connected');
      expect(await row()).toMatchObject({ status: 'ACTIVE', calendarId: 'work-ali' });
      expect((await row()).accountKey).toMatch(/^[0-9a-f]{64}$/);
      expect(google.calls.filter((c) => c.op === 'list')).toHaveLength(1);
      await sync();
      expect(keys('ali', 'work-ali')).toEqual(mine);
      expect(google.calls.filter((c) => c.op === 'insert' || c.op === 'delete')).toEqual([]);
    });

    it('the primary calendar: the old grant is asked who it is - the same stays, another is switched', async () => {
      const mine = await connected('primary');
      await forgetAccount();
      expect(await callback('ali')).toBe('connected');
      expect(keys('ali', 'primary')).toEqual(mine);
      expect((await links()).length).toBe(mine.length);

      await forgetAccount();
      expect(await callback('bob')).toBe('connected');
      // Removed from ali with ali's grant, then bob became the connection.
      expect(google.ours('ali')).toEqual([]);
      expect(google.calls.filter((c) => c.op === 'delete').every((c) => c.account === 'ali')).toBe(true);
      await sync();
      expect(keys('bob', 'primary')).toEqual(mine);
    });

    it('the old grant cannot be asked right now: nothing is changed', async () => {
      const mine = await connected('primary');
      await forgetAccount();
      await db.update(calendarConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(calendarConnections.userId, ownerId));
      google.failNext.push({ op: 'refresh', err: new GoogleApiError('google 503', 503, true, false) });
      const before = await row();
      expect(await callback('bob')).toBe('unverified');
      expect(await row()).toMatchObject({ status: 'ACTIVE', refreshTokenEnc: before.refreshTokenEnc, epoch: before.epoch });
      expect(keys('ali', 'primary')).toEqual(mine);
      expect(google.ours('bob')).toEqual([]);
    });

    it('the old grant no longer works: reconnecting updates the same events in place, never a second copy', async () => {
      const mine = await connected('primary');
      await forgetAccount();
      await db.update(calendarConnections).set({ status: 'NEEDS_RECONNECT', tokenExpiresAt: new Date(0) }).where(eq(calendarConnections.userId, ownerId));
      google.kill('ali');
      expect(await callback('ali')).toBe('connected');
      await sync();
      expect(keys('ali', 'primary')).toEqual(mine);
      expect(new Set(google.ours('ali').map((e) => e.id)).size).toBe(mine.length);
    });
  });

  describe('another account, confirmed', () => {
    it('the old account is cleaned like a disconnect - seen in the status, retried - and only then does the new one take over', async () => {
      const mine = await connected('work-ali');
      const aliKey = (await row()).accountKey;
      google.failNext.push({ op: 'delete', err: new GoogleApiError('google 503', 503, true, false) });
      expect(await callback('bob')).toBe('switching');
      const mid = await row();
      expect(mid).toMatchObject({ status: 'DISCONNECTING', accountKey: aliKey, attempts: 1 });
      expect(mid.nextRefreshTokenEnc).toBeTruthy();
      expect(mid.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      const st = await status();
      expect(st).toMatchObject({ status: 'DISCONNECTING', switching: true, cleanup: { events: mine.length } });
      // Nothing of ali's is lost track of, nothing is written to bob yet.
      expect(keys('ali', 'work-ali')).toEqual(mine);
      expect(google.ours('bob')).toEqual([]);
      expect(google.revoked).toEqual([]);
      // No sync while it waits; the poller retries the clean-up.
      await http().post('/api/calendar/google/sync').set(bearer(owner)).expect(409);
      await db.update(calendarConnections).set({ nextAttemptAt: null }).where(eq(calendarConnections.userId, ownerId));
      await svc().syncDue(10, ownCenters);
      const after = await row();
      expect(after).toMatchObject({ status: 'ACTIVE', calendarId: 'primary', nextRefreshTokenEnc: null, leftoverEvents: 0, lockToken: null });
      expect(after.accountKey).not.toBe(aliKey);
      expect(after.epoch).toBeGreaterThan(mid.epoch);
      expect(google.ours('ali')).toEqual([]);
      expect(google.revoked).toHaveLength(1); // ali's grant, after its events were gone
      await sync();
      expect(keys('bob', 'primary')).toEqual(mine);
      expect(google.calls.filter((c) => c.op === 'delete').every((c) => c.account === 'ali')).toBe(true);
    });

    it('the old grant is already gone: its events are counted as left behind, and the new account starts clean', async () => {
      const mine = await connected('work-ali');
      await db.update(calendarConnections).set({ tokenExpiresAt: new Date(0) }).where(eq(calendarConnections.userId, ownerId));
      google.kill('ali');
      expect(await callback('bob')).toBe('connected');
      expect(await row()).toMatchObject({ status: 'ACTIVE', calendarId: 'primary', leftoverEvents: mine.length });
      expect(await links()).toEqual([]);
      expect((await status()).leftoverEvents).toBe(mine.length);
      await sync();
      expect(keys('bob', 'primary')).toEqual(mine);
      expect(keys('ali', 'work-ali')).toEqual(mine); // untouched: we could not reach them
    });

    it('disconnect while another account is waiting: the waiting grant is dropped, the disconnect goes on', async () => {
      await connected('work-ali');
      google.failNext.push({ op: 'delete', err: new GoogleApiError('google 429', 429, true, false) });
      expect(await callback('bob')).toBe('switching');
      const res = (await http().delete('/api/calendar/google').set(bearer(owner)).expect(200)).body;
      expect(res.pending + res.removedEvents).toBeGreaterThan(0);
      await db.update(calendarConnections).set({ nextAttemptAt: null, lockedUntil: null, lockToken: null }).where(eq(calendarConnections.userId, ownerId));
      await svc().syncDue(10, ownCenters);
      expect(await row()).toBeUndefined();
      expect(google.ours('ali')).toEqual([]);
      expect(google.ours('bob')).toEqual([]);
      expect(google.revoked).toHaveLength(2); // the waiting grant, then the old one
    });
  });

  // ---- two actors at once ------------------------------------------------------

  describe('races', () => {
    it('a reconnect of the same account while its disconnect is still cleaning up: the connection stays', async () => {
      const mine = await connected('work-ali');
      const gate = google.hold('delete');
      const leaving = http().delete('/api/calendar/google').set(bearer(owner)).then((r) => r.body);
      await gate.reached;
      expect((await row()).status).toBe('DISCONNECTING');
      expect(await callback('ali')).toBe('connected');
      const active = await row();
      expect(active).toMatchObject({ status: 'ACTIVE', calendarId: 'work-ali', lockToken: null });
      gate.release();
      const res = await leaving;
      // The clean-up finished the one delete it was in and then saw the connection was no longer its own.
      expect(res.removedEvents).toBeLessThanOrEqual(1);
      const still = await row();
      expect(still).toMatchObject({ id: active.id, status: 'ACTIVE', epoch: active.epoch, refreshTokenEnc: active.refreshTokenEnc });
      expect(google.revoked).toEqual([]);
      await sync();
      expect(keys('ali', 'work-ali')).toEqual(mine);
      expect(new Set(google.ours('ali').map((e) => e.id)).size).toBe(mine.length);
    });

    it('another account arrives while a sync is writing: the sync stops, the old account is emptied, nothing lands in the wrong one', async () => {
      await reset();
      expect(await callback('ali')).toBe('connected');
      const gate = google.hold('insert');
      await forceDue();
      const syncing = svc().syncDue(10, ownCenters);
      await gate.reached;
      // The sync holds the lease: the switch waits for the poller.
      expect(await callback('bob')).toBe('switching');
      gate.release();
      await syncing;
      // That one event did reach ali (Google had the request); it is tracked, so it can be removed.
      expect(google.ours('ali').length).toBe((await links()).length);
      expect(google.ours('ali').length).toBeLessThanOrEqual(1);
      expect((await row()).status).toBe('DISCONNECTING');
      await svc().syncDue(10, ownCenters);
      expect(await row()).toMatchObject({ status: 'ACTIVE', calendarId: 'primary' });
      expect(google.ours('ali')).toEqual([]);
      await sync();
      expect(google.ours('bob').length).toBeGreaterThan(2);
      expect(google.calls.filter((c) => c.op === 'insert' && c.account === 'ali').length).toBeLessThanOrEqual(1);
    });

    it('two sign-ins return at the same moment: one connection, one account, no event in the other', async () => {
      const callbackUrl = async (account: string) => {
        const { url } = (await http().post('/api/calendar/google/connect').set(bearer(owner)).send({}).expect(201)).body;
        return `/api/calendar/google/callback?code=acct:${account}&state=${new URL(url).searchParams.get('state')}`;
      };
      const settle = async () => {
        for (let i = 0; i < 4; i++) {
          await db.update(calendarConnections).set({ nextAttemptAt: null }).where(eq(calendarConnections.userId, ownerId));
          await svc().syncDue(10, ownCenters);
        }
        await sync();
      };
      // The same account twice.
      await reset();
      const same = await Promise.all([callbackUrl('ali'), callbackUrl('ali')]);
      const a = await Promise.all(same.map((u) => http().get(u).expect(302)));
      expect(a.map((r) => new URL(r.headers.location).searchParams.get('google'))).toEqual(['connected', 'connected']);
      expect(await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ownerId))).toHaveLength(1);
      await settle();
      const mine = keys('ali', 'primary');
      expect(new Set(google.ours('ali').map((e) => e.id)).size).toBe(mine.length);

      // Two different accounts, three rounds.
      for (let round = 0; round < 3; round++) {
        await reset();
        const two = await Promise.all([callbackUrl('ali'), callbackUrl('bob')]);
        const b = await Promise.all(two.map((u) => http().get(u).expect(302)));
        for (const r of b) expect(['connected', 'switching']).toContain(new URL(r.headers.location).searchParams.get('google'));
        await settle();
        const rows = await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ownerId));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'ACTIVE', nextRefreshTokenEnc: null });
        const [withEvents, without] = google.ours('ali').length ? ['ali', 'bob'] : ['bob', 'ali'];
        expect(keys(withEvents, 'primary')).toEqual(mine);
        expect(google.ours(without)).toEqual([]);
      }
    });

    it('a sync longer than its lease keeps the lease while it works', async () => {
      await reset();
      expect(await callback('ali')).toBe('connected');
      const first = google.hold('insert');
      const second = google.hold('insert');
      await forceDue();
      const syncing = svc().syncDue(10, ownCenters);
      await first.reached;
      // The lease is about to run out while the first write is still in flight.
      await db.update(calendarConnections).set({ lockedUntil: new Date(Date.now() + 1500) }).where(eq(calendarConnections.userId, ownerId));
      first.release();
      await second.reached;
      // Before the second write the worker renewed it: minutes again, not seconds.
      expect((await row()).lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 60_000);
      second.release();
      await syncing;
      expect(await row()).toMatchObject({ status: 'ACTIVE', lockedUntil: null, lockToken: null, lastError: null });
      expect(google.ours('ali').length).toBeGreaterThan(2);
    });

    it('a stalled worker and the one that took over: no second copy, and the stalled one frees or overwrites nothing', async () => {
      await reset();
      expect(await callback('ali')).toBe('connected');
      const gate = google.hold('insert');
      await forceDue();
      const stalled = svc().syncDue(10, ownCenters);
      await gate.reached;
      // The lease ran out; another worker claims the connection and syncs it all.
      const [claimed] = await db.update(calendarConnections).set({ lockedUntil: new Date(Date.now() + 300_000), lockToken: 'worker-two' })
        .where(eq(calendarConnections.userId, ownerId)).returning();
      const done = await svc().syncOne(claimed);
      expect(done).toMatchObject({ written: expect.any(Number) });
      const all = keys('ali', 'primary');
      expect(all.length).toBeGreaterThan(2);
      const afterTwo = await row();
      expect(afterTwo).toMatchObject({ lockToken: null, lockedUntil: null });
      expect(afterTwo.lastSyncAt).toBeTruthy();
      // A third holder has it by the time the stalled worker wakes up.
      const until = new Date(Date.now() + 240_000);
      await db.update(calendarConnections).set({ lockedUntil: until, lockToken: 'worker-three', lastError: 'kept' }).where(eq(calendarConnections.userId, ownerId));
      gate.release();
      await stalled;
      const end = await row();
      // Not freed, not overwritten, not marked failed or synced by the worker that lost it.
      expect(end).toMatchObject({ status: 'ACTIVE', lockToken: 'worker-three', lastError: 'kept', attempts: afterTwo.attempts, epoch: afterTwo.epoch });
      expect(end.lockedUntil!.getTime()).toBe(until.getTime());
      expect(end.lastSyncAt!.getTime()).toBe(afterTwo.lastSyncAt!.getTime());
      // The write it was in the middle of met the same event id: one event each, still.
      expect(keys('ali', 'primary')).toEqual(all);
      expect(new Set(google.ours('ali').map((e) => e.id)).size).toBe(all.length);
      expect((await links()).length).toBe(all.length);
      await wait(10);
    });

    it('a clean-up that lost its lease deletes nothing more and does not remove the row', async () => {
      const mine = await connected('primary');
      const gate = google.hold('delete');
      const leaving = http().delete('/api/calendar/google').set(bearer(owner)).then((r) => r.body);
      await gate.reached;
      // Another worker has taken the clean-up over.
      await db.update(calendarConnections).set({ lockToken: 'other-cleaner', lockedUntil: new Date(Date.now() + 300_000) }).where(eq(calendarConnections.userId, ownerId));
      gate.release();
      const res = await leaving;
      expect(res.removedEvents).toBe(1);
      expect(res.pending).toBe(mine.length - 1);
      expect(await row()).toMatchObject({ status: 'DISCONNECTING', lockToken: 'other-cleaner' });
      expect(google.ours('ali').length).toBe(mine.length - 1);
      expect(google.revoked).toEqual([]);
    });
  });
});
