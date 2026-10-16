import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { auditLogs } from '../src/db/schema.js';

// A make-up is booked into a lesson that has not begun yet - checked by the
// server when the booking is saved, in the center's time zone, for a seat in
// a group's lesson and for a session alike. Entering one afterwards (the
// make-up was held, the record is late) is a correction: its own access, a
// reason, and an audit entry of its own.
describe('Make-up booking time: before the lesson, or a correction (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  // Center-local calendar (Asia/Tashkent, UTC+5, no DST).
  const local = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
  const today = local(0);
  const tomorrow = local(1);

  let owner: string, rec: string, home: string, host: string, tch: string, kid: string, tenantId: string;
  const credits: string[] = [];
  const book = (token: string, credit: string, body: Record<string, unknown>) => http().post(`/api/makeups/credits/${credit}/book`).set(bearer(token)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `MBT ${suffix}`, subdomain: `mbt-${suffix}`, email: `mbt-${suffix}@test.uz`, password: 'password123', fullName: 'Owner MBT' })
      .expect(201)).body;
    owner = reg.accessToken;
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `mbt-rec-${suffix}@test.uz`, role: 'RECEPTIONIST' }).expect(201)).body;
    rec = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: 'MBT Reception', password: 'password12345' }).expect(201)).body.accessToken;
    tch = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: 'MBT Teacher', subject: 'Math' }).expect(201)).body.id;
    // The student's own group meets every day 07:00-07:30; the host group has lessons today (all day) and tomorrow at 10.
    home = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'MBT Home', subject: 'Math', scheduleDays: 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba', startTime: '07:00', endTime: '07:30' }).expect(201)).body.id;
    host = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'MBT Host', subject: 'Math', maxStudents: 10 }).expect(201)).body.id;
    for (const [date, s, e] of [[today, '00:00', '23:59'], [tomorrow, '10:00', '11:00'], [local(-3), '12:00', '13:00']]) {
      await http().post('/api/schedule').set(bearer(owner)).send({ groupId: host, date, startTime: s, endTime: e }).expect(201);
    }
    kid = (await http().post('/api/students').set(bearer(owner)).send({ fullName: 'MBT Kid', groupIds: [home] }).expect(201)).body.id;
    // Absences before the student was entered are accepted as theirs (enrollments/membership.ts).
    for (const back of [5, 6, 7, 8, 9, 10]) {
      await http().post('/api/attendance').set(bearer(owner)).send({ groupId: home, date: local(-back), entries: [{ studentId: kid, status: 'ABSENT' }] }).expect(201);
      credits.push((await http().post('/api/makeups/credits').set(bearer(owner)).send({ studentId: kid, groupId: home, date: local(-back), reason: 'ABSENT' }).expect(201)).body.id);
    }
    tenantId = (await db.query.groups.findFirst({ where: (g, { eq: e }) => e(g.id, home) }))!.tenantId;
  }, 180_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { await app?.close(); });

  it('a lesson that has begun is refused for both modes; one still to come is booked', async () => {
    expect((await book(rec, credits[0], { mode: 'GROUP_LESSON', targetGroupId: host, date: today }).expect(409)).body.code).toBe('LESSON_STARTED');
    expect((await book(rec, credits[0], { mode: 'SESSION', date: today, startTime: '00:00', endTime: '00:45', teacherId: tch }).expect(409)).body.code).toBe('LESSON_STARTED');
    expect((await book(rec, credits[0], { mode: 'GROUP_LESSON', targetGroupId: host, date: local(-3) }).expect(409)).body.code).toBe('LESSON_STARTED');
    await book(rec, credits[0], { mode: 'GROUP_LESSON', targetGroupId: host, date: tomorrow }).expect(201);
  });

  it('a lesson that begins while the form is open is refused when it is saved', async () => {
    // The clock moves on to 10:00:30 tomorrow (center time) before Save is pressed.
    const at = new Date(`${tomorrow}T10:00:30+05:00`).getTime();
    vi.spyOn(Date, 'now').mockReturnValue(at);
    expect((await book(rec, credits[1], { mode: 'GROUP_LESSON', targetGroupId: host, date: tomorrow }).expect(409)).body.code).toBe('LESSON_STARTED');
    expect((await book(rec, credits[1], { mode: 'SESSION', date: tomorrow, startTime: '10:00', endTime: '10:45', teacherId: tch }).expect(409)).body.code).toBe('LESSON_STARTED');
    vi.restoreAllMocks();
    await book(rec, credits[1], { mode: 'SESSION', date: tomorrow, startTime: '15:00', endTime: '15:45', teacherId: tch }).expect(201);
  });

  it('a correction afterwards: its own access, a reason, an audit entry; never for a lesson still to come', async () => {
    const body = { mode: 'GROUP_LESSON', targetGroupId: host, date: local(-3), historical: true };
    expect((await book(rec, credits[2], { ...body, reason: 'Kech kiritildi' }).expect(403)).body.code).toBe('CORRECTION_NOT_ALLOWED');
    expect((await book(owner, credits[2], body).expect(400)).body.code).toBe('REASON_REQUIRED');
    expect((await book(owner, credits[2], { mode: 'GROUP_LESSON', targetGroupId: host, date: tomorrow, historical: true, reason: 'Kech kiritildi' }).expect(400)).body.code).toBe('NOT_HISTORICAL');
    const saved = (await book(owner, credits[2], { ...body, reason: 'Kech kiritildi: jurnalda bor' }).expect(201)).body;
    await expect.poll(async () => (await db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entityId, saved.id)))).map((r) => [r.action, (JSON.parse(String(r.meta)) as { reason?: string }).reason]))
      .toEqual([['makeup.book_historical', 'Kech kiritildi: jurnalda bor']]);
    // Older than the 30 days a correction may reach: refused.
    await book(owner, credits[3], { ...body, date: local(-40), reason: 'Juda eski' }).expect(400);
  });
});
