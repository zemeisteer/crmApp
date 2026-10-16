import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { calendarConnections, tenants } from '../src/db/schema.js';
import { CalendarSyncService } from '../src/calendar/calendar-sync.service.js';
import { CalendarEventsService } from '../src/calendar/calendar-events.service.js';
import { GOOGLE_CALENDAR_API, GoogleApiError, type GoogleCalendarApi, type GoogleEventBody } from '../src/calendar/google-calendar.api.js';

type Stored = GoogleEventBody & { id: string };

/** Google, in memory: one account and its primary calendar. An id given twice is a 409, as at Google. */
class FakeGoogle implements GoogleCalendarApi {
  events = new Map<string, Stored>();
  inserts = 0;
  failNext: Array<{ op: string; err: GoogleApiError }> = [];
  private fail(op: string) {
    const i = this.failNext.findIndex((f) => f.op === op);
    if (i >= 0) throw this.failNext.splice(i, 1)[0].err;
  }
  authUrl(p: { state: string }) { return `https://accounts.example/auth?state=${p.state}`; }
  async exchangeCode() { return { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3600_000) }; }
  async refresh() { return { accessToken: 'access', expiresAt: new Date(Date.now() + 3600_000) }; }
  async revoke() {}
  async listCalendars() { return [{ id: 'me@gmail.test', summary: 'Me', primary: true }]; }
  async insertEvent(_t: string, _c: string, body: GoogleEventBody) {
    this.inserts += 1;
    // Applied at Google, then the answer is lost: the next try meets the same id.
    if (this.failNext.some((f) => f.op === 'insert-lost')) {
      this.failNext = this.failNext.filter((f) => f.op !== 'insert-lost');
      this.events.set(body.id!, { ...body, id: body.id! });
      throw new GoogleApiError('google 503 (answer lost)', 503, true, false);
    }
    this.fail('insert');
    if (body.id && this.events.has(body.id)) throw new GoogleApiError('google 409 duplicate', 409, false, false);
    const id = body.id ?? `g${this.inserts}`;
    this.events.set(id, { ...body, id });
    return { id };
  }
  async patchEvent(_t: string, _c: string, id: string, body: GoogleEventBody) {
    if (!this.events.has(id)) throw new GoogleApiError('google 404', 404, false, false);
    this.events.set(id, { ...this.events.get(id)!, ...body, id });
    return { id };
  }
  async deleteEvent(_t: string, _c: string, id: string) { this.events.delete(id); }
  byKey(key: string) { return [...this.events.values()].filter((e) => e.extendedProperties?.private?.key === key); }
}

// Center events in the calendars: in the feed of whoever is meant to see them
// (decided on the server by the audience), with a stable UID, the center's
// time zone, the place or the link; and in Google created once, changed in
// place, removed when the event is deleted. No real Google is reached: a live
// check needs credentials and a consent screen, and is reported as blocked.
describe('Center events in calendar feeds and Google (e2e, Google stand-in)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const google = new FakeGoogle();
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const prevEnv: Record<string, string | undefined> = {};
  const day = new Date(Date.now() + 5 * 3_600_000 + 10 * 86_400_000).toISOString().slice(0, 10);

  let owner: string, ownerId: string, tenantId: string, teacherUser: string, parentUser: string, studentId: string, room: string;
  let staffMeeting: string, competition: string, openDay: string;
  const svc = () => app.get(CalendarSyncService);
  const keysFor = async (scope: 'CENTER' | 'TEACHER' | 'PARENT' | 'STUDENT', who: { userId?: string; studentId?: string }) =>
    (await app.get(CalendarEventsService).events({ tenantId, scope, ...who }, day, day)).filter((e) => e.uid.startsWith('cev-')).map((e) => e.uid).sort();
  const sync = async () => {
    await db.update(calendarConnections).set({ nextAttemptAt: null, lockedUntil: null, syncRequestedAt: new Date() }).where(eq(calendarConnections.userId, ownerId));
    await svc().syncDue(10, [tenantId]);
  };

  beforeAll(async () => {
    for (const k of ['PUBLIC_API_URL', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'CALENDAR_SYNC_MS', 'CALENDAR_TOKEN_KEY']) prevEnv[k] = process.env[k];
    Object.assign(process.env, {
      PUBLIC_API_URL: 'https://crm.example.uz/api',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', GOOGLE_REDIRECT_URI: 'https://crm.example.uz/api/calendar/google/callback',
      CALENDAR_SYNC_MS: '0', CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64'),
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(GOOGLE_CALENDAR_API).useValue(google).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `CCE ${suffix}`, subdomain: `cce-${suffix}`, email: `cce-${suffix}@test.uz`, password: 'password123', fullName: 'Owner CCE' })
      .expect(201)).body;
    owner = reg.accessToken;
    ownerId = reg.user.id;
    const invite = async (role: string, local: string) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `cce-${local}-${suffix}@test.uz`, role }).expect(201)).body;
      return (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body.user.id as string;
    };
    teacherUser = await invite('TEACHER', 't');
    await http().post('/api/teachers').set(bearer(owner)).send({ fullName: 'CCE Teacher', userId: teacherUser, subject: 'Math' }).expect(201);
    parentUser = await invite('PARENT', 'p');
    const g = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'CCE Group', subject: 'Math' }).expect(201)).body.id;
    studentId = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'CCE Kid', groupIds: [g] }).expect(201)).body.id;
    await http().post(`/api/students/${studentId}/guardians`).set(bearer(owner)).send({ userId: parentUser, relationship: 'Ota' }).expect(201);
    room = (await http().post('/api/schedule/rooms').set(bearer(owner)).send({ name: 'Katta zal' }).expect(201)).body.id;
    const ev = async (body: Record<string, unknown>) => (await http().post('/api/center-events').set(bearer(owner)).send({ kind: 'MEETING', format: 'OFFLINE', date: day, ...body }).expect(201)).body.id as string;
    staffMeeting = await ev({ title: "O'qituvchilar yig'ilishi", audience: 'STAFF', startTime: '09:00', endTime: '10:00', roomId: room });
    competition = await ev({ title: 'Shaxmat musobaqasi', kind: 'COMPETITION', audience: 'STUDENTS', startTime: '15:00', location: 'Sport zali' });
    openDay = await ev({ title: 'Ochiq eshiklar kuni', kind: 'EVENT', format: 'ONLINE', audience: 'ALL', startTime: '18:00', endTime: '19:30', meetingUrl: 'https://meet.example.com/open', description: 'Hamma uchun' });
    tenantId = (await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.subdomain, `cce-${suffix}`)))[0].id;
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('who sees which event is decided by its audience: a staff meeting never reaches a cabinet', async () => {
    expect(await keysFor('CENTER', { userId: ownerId })).toEqual([`cev-${competition}`, `cev-${openDay}`, `cev-${staffMeeting}`].sort());
    expect(await keysFor('TEACHER', { userId: teacherUser })).toEqual([`cev-${openDay}`, `cev-${staffMeeting}`].sort());
    expect(await keysFor('PARENT', { userId: parentUser })).toEqual([`cev-${competition}`, `cev-${openDay}`].sort());
    expect(await keysFor('STUDENT', { studentId })).toEqual([`cev-${competition}`, `cev-${openDay}`].sort());
  });

  it('the feed: stable UID, UTC times from the center\'s zone, the room or the link, and an event without an end is zero-length', async () => {
    const url = (await http().post('/api/calendar/feed').set(bearer(owner)).expect(201)).body.url as string;
    const body = (await http().get(new URL(url).pathname).expect(200)).text.replace(/\r\n /g, '');
    const block = (id: string) => body.split('BEGIN:VEVENT').find((b) => b.includes(`cev-${id}`))!;
    const compact = day.replace(/-/g, '');
    // Asia/Tashkent is UTC+5.
    expect(block(staffMeeting)).toContain(`DTSTART:${compact}T040000Z`);
    expect(block(staffMeeting)).toContain(`DTEND:${compact}T050000Z`);
    expect(block(staffMeeting)).toContain('LOCATION:Katta zal');
    expect(block(competition)).toContain(`DTSTART:${compact}T100000Z`);
    expect(block(competition)).toContain(`DTEND:${compact}T100000Z`);
    expect(block(competition)).toContain('LOCATION:Sport zali');
    expect(block(openDay)).toContain('LOCATION:https://meet.example.com/open');
    expect(block(openDay)).toMatch(/DESCRIPTION:Hamma uchun\\nhttps:\/\/meet\.example\.com\/open/);
    // The same again on the next read: the UID does not change.
    const again = (await http().get(new URL(url).pathname).expect(200)).text;
    expect(again).toContain(`UID:cev-${staffMeeting}`);
  });

  it('Google: created once (a lost answer and a retry make no copy), changed in place, removed when deleted', async () => {
    const { url } = (await http().post('/api/calendar/google/connect').set(bearer(owner)).send({}).expect(201)).body;
    await http().get(`/api/calendar/google/callback?code=x&state=${new URL(url).searchParams.get('state')}`).expect(302);
    expect((await db.select().from(calendarConnections).where(eq(calendarConnections.userId, ownerId)))[0].tenantId).toBe(tenantId);

    // The first insert of the staff meeting is applied at Google but its answer is lost.
    google.failNext.push({ op: 'insert-lost', err: new GoogleApiError('x', 503, true, false) });
    await sync();
    expect(google.failNext).toHaveLength(0); // the lost answer did happen
    await sync();
    for (const id of [staffMeeting, competition, openDay]) expect(google.byKey(`cev-${id}`)).toHaveLength(1);

    // Moved and renamed: the same Google event changes.
    const before = google.byKey(`cev-${staffMeeting}`)[0].id;
    await http().patch(`/api/center-events/${staffMeeting}`).set(bearer(owner)).send({ title: "Yig'ilish (ko'chirildi)", startTime: '11:00', endTime: '12:00' }).expect(200);
    await sync();
    const moved = google.byKey(`cev-${staffMeeting}`);
    expect(moved).toHaveLength(1);
    expect(moved[0]).toMatchObject({ id: before, summary: "Yig'ilish (ko'chirildi)" });
    expect(moved[0].start.dateTime).toBe(`${day}T06:00:00.000Z`);

    // Deleted: gone from Google too.
    await http().delete(`/api/center-events/${competition}`).set(bearer(owner)).expect(200);
    await sync();
    expect(google.byKey(`cev-${competition}`)).toHaveLength(0);
    expect(google.byKey(`cev-${openDay}`)).toHaveLength(1);
  });
});
