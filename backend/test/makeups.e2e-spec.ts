import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { makeupCredits } from '../src/db/schema.js';

// Make-up lessons: a credit for one missed lesson, issued by staff, booked
// into another group's lesson or a dedicated session, consumed once by
// attendance - with the races, the tenants and the money kept honest.
describe('Make-up lessons (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Center-local calendar (Asia/Tashkent, UTC+5, no DST).
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  // The next date (from tomorrow) with ISO weekday `w`, plus `weeks` weeks.
  const next = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i + weeks * 7));
    throw new Error('unreachable');
  };
  // The latest past date with weekday `w`, minus `weeks` weeks.
  const last = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(-i)) === w) return dateOf(tashkent(-i - weeks * 7));
    throw new Error('unreachable');
  };

  let ownerA: string, managerA: string, recA: string, t1: string, t2: string, t3: string, ownerB: string;
  let tch3: string, g1: string, g2: string, gSmall: string, s1: string, s2: string, s1Phone: string, s2Phone: string;
  let room: string;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `MK ${key} ${suffix}`, subdomain: `mk-${key}-${suffix}`, email: `mk-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `mk-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  const absent = (token: string, groupId: string, studentId: string, date: string) =>
    http().post('/api/attendance').set(bearer(token)).send({ groupId, date, entries: [{ studentId, status: 'ABSENT' }] }).expect(201);
  const issue = (token: string, body: Record<string, unknown>) => http().post('/api/makeups/credits').set(bearer(token)).send(body);
  const book = (token: string, creditId: string, body: Record<string, unknown>) => http().post(`/api/makeups/credits/${creditId}/book`).set(bearer(token)).send(body);
  const credit = async (id: string) => (await http().get('/api/makeups/credits').set(bearer(ownerA)).expect(200)).body.find((c: { id: string }) => c.id === id);
  const payroll = async (month: string) => (await http().get(`/api/salary-payments/calculate?forMonth=${month}`).set(bearer(ownerA)).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    ownerA = await register('a');
    managerA = (await invite(ownerA, 'MANAGER', 'mgr')).token;
    recA = (await invite(ownerA, 'RECEPTIONIST', 'rec')).token;
    const u1 = await invite(ownerA, 'TEACHER', 't1'); t1 = u1.token;
    const u2 = await invite(ownerA, 'TEACHER', 't2'); t2 = u2.token;
    const u3 = await invite(ownerA, 'TEACHER', 't3'); t3 = u3.token;
    const mk = async (name: string, userId: string) => (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: name, userId, subject: 'English', salaryType: 'PER_LESSON', salaryValue: 100_000 }).expect(201)).body.id as string;
    const tch1 = await mk('MK T1', u1.userId);
    const tch2 = await mk('MK T2', u2.userId);
    tch3 = await mk('MK T3', u3.userId);
    // G1 Monday 10-11 (T1), G2 Wednesday 10-11 (T2), a 1-seat group on Friday (T2).
    g1 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'MK G1', subject: 'English', teacherId: tch1, scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00', maxStudents: 10 }).expect(201)).body.id;
    g2 = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'MK G2', subject: 'English', teacherId: tch2, scheduleDays: 'Chorshanba', startTime: '10:00', endTime: '11:00', maxStudents: 10 }).expect(201)).body.id;
    gSmall = (await http().post('/api/groups').set(bearer(ownerA)).send({ name: 'MK Small', subject: 'English', teacherId: tch2, scheduleDays: 'Juma', startTime: '15:00', endTime: '16:00', maxStudents: 1 }).expect(201)).body.id;
    s1Phone = `+99893${String(suffix).slice(-7)}`;
    s2Phone = `+99894${String(suffix).slice(-7)}`;
    s1 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'MK Student One', phone: s1Phone, groupIds: [g1] }).expect(201)).body.id;
    s2 = (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: 'MK Student Two', phone: s2Phone, groupIds: [g1] }).expect(201)).body.id;
    room = (await http().post('/api/schedule/rooms').set(bearer(ownerA)).send({ name: 'MK Room', capacity: 4 }).expect(201)).body.id;
    ownerB = await register('b');
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  let c1: string;

  it('issues a credit for a real absence only; never twice; staff only; never across centers', async () => {
    const missed = last(1);
    // A status the database does not hold is a 400, not a 500.
    await http().post('/api/attendance').set(bearer(t1)).send({ groupId: g1, date: missed, entries: [{ studentId: s1, status: 'EXCUSED' }] }).expect(400);
    await absent(t1, g1, s1, missed);
    await issue(t1, { studentId: s1, groupId: g1, date: missed, reason: 'ABSENT' }).expect(403); // teachers do not issue
    await issue(recA, { studentId: s1, groupId: g1, date: last(1, 1), reason: 'ABSENT' }).expect(400); // not marked absent
    await issue(recA, { studentId: s1, groupId: g1, date: 'tomorrow', reason: 'ABSENT' }).expect(400);
    await issue(ownerB, { studentId: s1, groupId: g1, date: missed, reason: 'ABSENT' }).expect(404);
    const created = (await issue(recA, { studentId: s1, groupId: g1, date: missed, reason: 'ABSENT', note: 'ill' }).expect(201)).body;
    c1 = created.id;
    expect(created.status).toBe('ISSUED');
    expect(created.expiresAt).toBeNull(); // no expiry policy set
    const dup = await issue(managerA, { studentId: s1, groupId: g1, date: missed, reason: 'ABSENT' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_CREDIT');
    // Two at once: exactly one.
    const other = last(1, 1);
    await absent(t1, g1, s1, other);
    const race = await Promise.all([0, 1, 2].map(() => issue(recA, { studentId: s1, groupId: g1, date: other, reason: 'ABSENT' })));
    expect(race.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    // The eligible list shows both absences with their credits.
    const eligible = (await http().get(`/api/makeups/eligible?from=${last(1, 2)}&to=${dateOf(tashkent(0))}`).set(bearer(recA)).expect(200)).body;
    expect(eligible.filter((e: { studentId: string; credit: unknown }) => e.studentId === s1 && e.credit).length).toBe(2);
  });

  it('books a seat in another group lesson; the full lesson, a day without lesson, the own group and other centers are refused', async () => {
    const wed = next(3);
    await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: next(4) }).expect(400); // G2 has no Thursday lesson
    await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g1, date: next(1) }).expect(400); // already in G1
    await book(ownerB, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: wed }).expect(404);
    await book(t2, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: wed }).expect(403);
    const b = (await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: wed }).expect(201)).body;
    expect(b).toMatchObject({ mode: 'GROUP_LESSON', targetGroupId: g2, date: wed, startTime: '10:00', endTime: '11:00', status: 'BOOKED' });
    expect((await credit(c1)).status).toBe('BOOKED');
    // A booked credit cannot be booked again.
    expect((await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: next(3, 1) }).expect(409)).body.code).toBe('CREDIT_NOT_OPEN');
  });

  it("the target lesson's teacher sees the booking with the student's name only; others do not", async () => {
    const from = dateOf(tashkent(0));
    const to = next(3, 2);
    const r2 = (await http().get(`/api/makeups/roster?from=${from}&to=${to}`).set(bearer(t2)).expect(200)).body;
    expect(r2).toHaveLength(1);
    expect(r2[0].student).toEqual({ id: s1, fullName: 'MK Student One' });
    expect((await http().get(`/api/makeups/roster?from=${from}&to=${to}`).set(bearer(t3)).expect(200)).body).toEqual([]);
    expect((await http().get(`/api/makeups/roster?from=${from}&to=${to}`).set(bearer(t1)).expect(200)).body).toEqual([]);
    // The substitute does not get the student's profile or the original group.
    await http().get(`/api/students/${s1}`).set(bearer(t2)).expect(404);
    await http().get('/api/makeups/credits').set(bearer(t2)).expect(403);
  });

  it('two bookings racing for the last seat: one wins', async () => {
    // Fresh absences and credits for both students (the absence before last).
    const d = last(1, 2);
    await absent(t1, g1, s1, d);
    await absent(t1, g1, s2, d);
    const a = (await issue(recA, { studentId: s1, groupId: g1, date: d, reason: 'ABSENT' }).expect(201)).body.id;
    const b = (await issue(recA, { studentId: s2, groupId: g1, date: d, reason: 'ABSENT' }).expect(201)).body.id;
    const fri = next(5);
    const res = await Promise.all([a, b].map((id) => book(recA, id, { mode: 'GROUP_LESSON', targetGroupId: gSmall, date: fri })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(res.find((r) => r.status === 409)!.body.code).toBe('LESSON_FULL');
    // Clean up the winner for the next tests.
    const won = res.find((r) => r.status === 201)!.body.id;
    await http().post(`/api/makeups/bookings/${won}/cancel`).set(bearer(recA)).expect(201);
  });

  it('two bookings of one credit at once: one wins', async () => {
    const d = last(1, 3);
    await absent(t1, g1, s2, d);
    const id = (await issue(recA, { studentId: s2, groupId: g1, date: d, reason: 'ABSENT' }).expect(201)).body.id;
    const res = await Promise.all([next(3), next(3, 1), next(3, 2)].map((date) => book(recA, id, { mode: 'GROUP_LESSON', targetGroupId: g2, date })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const live = (await credit(id)).bookings.filter((x: { status: string }) => x.status === 'BOOKED');
    expect(live).toHaveLength(1);
  });

  it('cancelling a booking releases the credit; it can be booked again', async () => {
    const booking = (await credit(c1)).bookings.find((x: { status: string }) => x.status === 'BOOKED');
    await http().post(`/api/makeups/bookings/${booking.id}/cancel`).set(bearer(ownerB)).expect(404);
    await http().post(`/api/makeups/bookings/${booking.id}/cancel`).set(bearer(recA)).expect(201);
    expect((await credit(c1)).status).toBe('ISSUED');
    await http().post(`/api/makeups/bookings/${booking.id}/cancel`).set(bearer(recA)).expect(409);
    await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: next(3) }).expect(201);
  });

  it('attendance consumes the credit exactly once; the original absence and payroll are untouched', async () => {
    const month = next(3).slice(0, 7);
    const before = await payroll(month);
    const booking = (await credit(c1)).bookings.find((x: { status: string }) => x.status === 'BOOKED');
    await http().post(`/api/makeups/bookings/${booking.id}/attendance`).set(bearer(t3)).send({ status: 'ATTENDED' }).expect(404); // not their lesson
    await http().post(`/api/makeups/bookings/${booking.id}/attendance`).set(bearer(ownerB)).send({ status: 'ATTENDED' }).expect(404);
    await http().post(`/api/makeups/bookings/${booking.id}/attendance`).set(bearer(t2)).send({ status: 'MAYBE' }).expect(400);
    const marks = await Promise.all([0, 1, 2].map(() => http().post(`/api/makeups/bookings/${booking.id}/attendance`).set(bearer(t2)).send({ status: 'ATTENDED' })));
    expect(marks.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const used = await credit(c1);
    expect(used.status).toBe('USED');
    expect(used.bookings.filter((x: { status: string }) => x.status === 'ATTENDED')).toHaveLength(1);
    // The absence that earned it is still an absence.
    const att = (await http().get(`/api/attendance?groupId=${g1}`).set(bearer(ownerA)).expect(200)).body;
    expect(att.find((a: { studentId: string; date: string }) => a.studentId === s1 && a.date === used.originDate).status).toBe('ABSENT');
    // A used credit cannot be booked, cancelled or reinstated.
    await book(recA, c1, { mode: 'GROUP_LESSON', targetGroupId: g2, date: next(3, 1) }).expect(409);
    await http().post(`/api/makeups/credits/${c1}/cancel`).set(bearer(recA)).expect(409);
    await http().post(`/api/makeups/credits/${c1}/reinstate`).set(bearer(recA)).expect(409);
    expect(await payroll(month)).toEqual(before);
  });

  it('a dedicated session needs a free teacher and room; a missed make-up is forfeited and can be reinstated', async () => {
    const d = last(1, 4);
    await absent(t1, g1, s1, d);
    const id = (await issue(managerA, { studentId: s1, groupId: g1, date: d, reason: 'ABSENT' }).expect(201)).body.id;
    // T1 teaches G1 on Monday 10-11: busy.
    const busy = await http().get('/api/teachers').set(bearer(ownerA)).expect(200);
    const tch1 = busy.body.find((t: { fullName: string }) => t.fullName === 'MK T1').id;
    expect((await book(recA, id, { mode: 'SESSION', date: next(1), startTime: '10:30', endTime: '11:30', teacherId: tch1 }).expect(409)).body.code).toBe('SLOT_TAKEN');
    // The student's own lesson is then too.
    expect((await book(recA, id, { mode: 'SESSION', date: next(1), startTime: '10:30', endTime: '11:30', teacherId: tch3 }).expect(409)).body.code).toBe('STUDENT_BUSY');
    await book(recA, id, { mode: 'SESSION', date: next(2), startTime: '18:00', endTime: '17:00', teacherId: tch3 }).expect(400);
    const s = (await book(recA, id, { mode: 'SESSION', date: next(2), startTime: '17:00', endTime: '18:00', teacherId: tch3, roomId: room }).expect(201)).body;
    // Another session for the same room at the same time: taken.
    const d2 = last(1, 5);
    await absent(t1, g1, s2, d2);
    const id2 = (await issue(managerA, { studentId: s2, groupId: g1, date: d2, reason: 'ABSENT' }).expect(201)).body.id;
    expect((await book(recA, id2, { mode: 'SESSION', date: next(2), startTime: '17:30', endTime: '18:30', teacherId: tch3 }).expect(409)).body.code).toBe('SLOT_TAKEN');
    // T3 runs the session: sees it, marks it.
    const roster = (await http().get(`/api/makeups/roster?from=${dateOf(tashkent(0))}&to=${next(2)}`).set(bearer(t3)).expect(200)).body;
    expect(roster.map((r: { id: string }) => r.id)).toEqual([s.id]);
    await http().post(`/api/makeups/bookings/${s.id}/attendance`).set(bearer(t3)).send({ status: 'MISSED' }).expect(201);
    expect((await credit(id)).status).toBe('FORFEITED');
    await http().post(`/api/makeups/credits/${id}/reinstate`).set(bearer(t3)).expect(403);
    await http().post(`/api/makeups/credits/${id}/reinstate`).set(bearer(managerA)).expect(201);
    expect((await credit(id)).status).toBe('ISSUED');
  });

  it('a lesson called off: its students become eligible, bookings into it are released, restore is blocked while credits exist', async () => {
    const mon = next(1);
    await http().post('/api/lessons/cancellations').set(bearer(recA)).send({ groupId: g1, date: mon }).expect(403); // managers and admins
    await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g1, date: next(2) }).expect(400); // no G1 lesson on Tuesday
    const cancel = (await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g1, date: mon, reason: 'Holiday' }).expect(201)).body;
    await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g1, date: mon }).expect(409);
    const lessons = (await http().get(`/api/lessons?from=${mon}&to=${mon}&groupId=${g1}`).set(bearer(t1)).expect(200)).body;
    expect(lessons).toEqual([expect.objectContaining({ uid: `grp-${g1}-${mon}`, cancelled: true })]);
    const eligible = (await http().get(`/api/makeups/eligible?from=${mon}&to=${mon}`).set(bearer(recA)).expect(200)).body;
    expect(eligible.map((e: { studentId: string; reason: string }) => `${e.studentId}:${e.reason}`).sort()).toEqual([`${s1}:LESSON_CANCELLED`, `${s2}:LESSON_CANCELLED`].sort());
    const cc = (await issue(recA, { studentId: s2, groupId: g1, date: mon, reason: 'LESSON_CANCELLED' }).expect(201)).body.id;
    // Nobody can be booked into a lesson that does not happen.
    expect((await book(recA, cc, { mode: 'GROUP_LESSON', targetGroupId: g1, date: mon }).expect(400)).body.code).toBe('NO_LESSON');
    // A booking into G2 next Wednesday, then that lesson is called off: the booking goes, the credit comes back.
    const wed = next(3, 3);
    const b = (await book(recA, cc, { mode: 'GROUP_LESSON', targetGroupId: g2, date: wed }).expect(201)).body;
    const c2 = (await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g2, date: wed }).expect(201)).body;
    expect(c2.releasedBookings).toBe(1);
    expect((await credit(cc)).status).toBe('ISSUED');
    expect((await credit(cc)).bookings.find((x: { id: string }) => x.id === b.id).status).toBe('CANCELLED');
    // Restoring G1's Monday is blocked while a credit exists for it.
    expect((await http().delete(`/api/lessons/cancellations/${cancel.cancellation.id}`).set(bearer(managerA)).expect(409)).body.code).toBe('CREDITS_ISSUED');
    await http().post(`/api/makeups/credits/${cc}/cancel`).set(bearer(recA)).expect(201);
    await http().delete(`/api/lessons/cancellations/${cancel.cancellation.id}`).set(bearer(ownerB)).expect(404);
    await http().delete(`/api/lessons/cancellations/${cancel.cancellation.id}`).set(bearer(managerA)).expect(200);
  });

  it("another center sees none of it; the cabinet sees only the student's own", async () => {
    expect((await http().get('/api/makeups/credits').set(bearer(ownerB)).expect(200)).body).toEqual([]);
    expect((await http().get(`/api/makeups/roster?from=${dateOf(tashkent(-40))}&to=${dateOf(tashkent(60))}`).set(bearer(ownerB)).expect(200)).body).toEqual([]);
    const cab = async (id: string, phone: string) => {
      const { pin } = (await http().post(`/api/students/${id}/portal-pin`).set(bearer(ownerA)).expect(201)).body;
      return (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    };
    const mine = (await http().get('/api/portal/makeups').set(bearer(await cab(s1, s1Phone))).expect(200)).body;
    expect(mine.credits.length).toBeGreaterThan(0);
    expect(mine.bookings.some((b: { status: string; groupName: string }) => b.status === 'ATTENDED' && b.groupName === 'MK G2')).toBe(true);
    const theirs = (await http().get('/api/portal/makeups').set(bearer(await cab(s2, s2Phone))).expect(200)).body;
    const ids = new Set(mine.credits.map((c: { id: string }) => c.id));
    expect(theirs.credits.some((c: { id: string }) => ids.has(c.id))).toBe(false);
    await http().get('/api/portal/makeups').expect(401);
  });

  it('an expired credit cannot be booked; a center may set an expiry policy', async () => {
    await http().patch('/api/tenants/me').set(bearer(ownerA)).send({ makeupCreditDays: 30 }).expect(200);
    const d = last(1, 6);
    await absent(t1, g1, s2, d);
    const c = (await issue(recA, { studentId: s2, groupId: g1, date: d, reason: 'ABSENT' }).expect(201)).body;
    expect(new Date(c.expiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    const db = app.get<Database>(DB);
    await db.update(makeupCredits).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(makeupCredits.id, c.id));
    expect((await book(recA, c.id, { mode: 'GROUP_LESSON', targetGroupId: g2, date: next(3) }).expect(409)).body.code).toBe('CREDIT_EXPIRED');
    expect((await credit(c.id)).expired).toBe(true);
  });
});
