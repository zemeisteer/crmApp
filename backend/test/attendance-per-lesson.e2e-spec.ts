import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { attendance, makeupCredits, schedules } from '../src/db/schema.js';

// Attendance is kept per lesson: two lessons of a group on one day are
// marked apart, a mark stays with its lesson, old marks are bound only when
// it is clear which lesson they were for, and a make-up credit for an
// absence is the credit of that lesson's absence.
describe('Attendance per lesson, and the credits that rest on it (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  const next = (w: number, weeks = 0) => { for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i + weeks * 7)); throw new Error('unreachable'); };
  const last = (w: number, weeks = 0) => { for (let i = 1; i <= 7; i++) if (dow(tashkent(-i)) === w) return dateOf(tashkent(-i - weeks * 7)); throw new Error('unreachable'); };
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

  type Mark = { id: string; studentId: string; date: string; status: string; scheduleId: string | null; startTime: string | null };
  let owner: string, tenantId: string, t1: string, t2: string, t3: string;
  let tch1: string, tch2: string;
  let g: string, morning: string, evening: string, s1: string, s2: string;

  const mark = (token: string, body: Record<string, unknown>) => http().post('/api/attendance').set(bearer(token)).send(body);
  const marks = async (query: string) => (await http().get(`/api/attendance?${query}`).set(bearer(owner)).expect(200)).body as Mark[];
  const issue = (body: Record<string, unknown>) => http().post('/api/makeups/credits').set(bearer(owner)).send(body);
  const credits = async () => (await http().get('/api/makeups/credits').set(bearer(owner)).expect(200)).body as Array<{ id: string; status: string; note: string | null; originDate: string; originScheduleId: string | null; student: { id: string } }>;
  let seq = 0;
  const student = async (name: string, groupIds: string[]) => (await http().post('/api/students').set(bearer(owner))
    .send({ fullName: `APL ${name}`, phone: `+9986${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `APL ${suffix}`, subdomain: `apl-${suffix}`, email: `apl-${suffix}@test.uz`, password: 'password123', fullName: 'Owner APL' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.tenant.id;
    const teacherUser = async (local: string) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `apl-${local}-${suffix}@test.uz`, role: 'TEACHER' }).expect(201)).body;
      const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `APL ${local}`, password: 'password12345' }).expect(201)).body;
      const id = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: `APL ${local}`, userId: acc.user.id, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id as string;
      return { token: acc.accessToken as string, id };
    };
    const a = await teacherUser('t1'); t1 = a.token; tch1 = a.id;
    const b = await teacherUser('t2'); t2 = b.token; tch2 = b.id;
    t3 = (await teacherUser('t3')).token;
    // Saturday: 09:00 with the group's teacher, 15:00 given to another teacher.
    g = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'APL Twice', subject: 'English', teacherId: tch1, scheduleDays: DAYS[6], startTime: '09:00', endTime: '10:00', maxStudents: 30 }).expect(201)).body.id;
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, teacherId: tch2, dayOfWeek: 6, startTime: '15:00', endTime: '16:00' }).expect(201);
    const rows = (await http().get(`/api/schedule?groupId=${g}`).set(bearer(owner)).expect(200)).body as Array<{ id: string; startTime: string }>;
    morning = rows.find((r) => r.startTime === '09:00')!.id;
    evening = rows.find((r) => r.startTime === '15:00')!.id;
    s1 = await student('one', [g]);
    s2 = await student('two', [g]);
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('two lessons of one day are marked apart; a repeated or simultaneous save makes no second row; a bad entry saves nothing', async () => {
    const date = last(6);
    const unclear = await mark(owner, { groupId: g, date, entries: [{ studentId: s1, status: 'PRESENT' }] }).expect(400);
    expect(unclear.body.code).toBe('LESSON_AMBIGUOUS');
    expect(unclear.body.lessons.map((l: { scheduleId: string; startTime: string }) => [l.scheduleId, l.startTime])).toEqual([[morning, '09:00'], [evening, '15:00']]);
    expect((await mark(owner, { groupId: g, date, scheduleId: 'no-such-lesson', entries: [{ studentId: s1, status: 'PRESENT' }] }).expect(400)).body.code).toBe('NO_LESSON');

    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'PRESENT' }, { studentId: s2, status: 'ABSENT' }] }).expect(201);
    await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s1, status: 'ABSENT' }, { studentId: s2, status: 'PRESENT' }] }).expect(201);
    const all = await marks(`groupId=${g}&date=${date}`);
    expect(all.map((m) => [m.studentId, m.scheduleId, m.startTime, m.status]).sort()).toEqual([
      [s1, morning, '09:00', 'PRESENT'], [s1, evening, '15:00', 'ABSENT'], [s2, morning, '09:00', 'ABSENT'], [s2, evening, '15:00', 'PRESENT'],
    ].sort());
    expect((await marks(`groupId=${g}&date=${date}&scheduleId=${evening}`)).map((m) => m.studentId).sort()).toEqual([s1, s2].sort());

    // The same save five times at once, then once more with another status.
    const same = await Promise.all([0, 1, 2, 3, 4].map(() => mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'LATE' }, { studentId: s2, status: 'ABSENT' }] })));
    expect(same.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const after = await marks(`groupId=${g}&date=${date}`);
    expect(after).toHaveLength(4);
    expect(after.find((m) => m.studentId === s1 && m.scheduleId === morning)).toMatchObject({ status: 'LATE', id: all.find((m) => m.studentId === s1 && m.scheduleId === morning)!.id });

    // One entry is not a student of the group: nothing of that save is written.
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'ABSENT' }, { studentId: 'not-a-student', status: 'PRESENT' }] }).expect(400);
    expect((await marks(`groupId=${g}&date=${date}&scheduleId=${morning}`)).find((m) => m.studentId === s1)!.status).toBe('LATE');
  });

  it('a mark stays with its lesson when the lesson moves, and stays as history when the lesson is removed', async () => {
    const date = last(6, 1);
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
    await http().patch(`/api/schedule/${morning}`).set(bearer(owner)).send({ startTime: '08:00', endTime: '09:00' }).expect(200);
    const kept = await marks(`groupId=${g}&date=${date}`);
    expect(kept).toEqual([expect.objectContaining({ studentId: s1, scheduleId: morning, status: 'ABSENT' })]);
    // Marked again: still that lesson's one row, now with its new start.
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'PRESENT' }] }).expect(201);
    expect(await marks(`groupId=${g}&date=${date}`)).toEqual([expect.objectContaining({ id: kept[0].id, scheduleId: morning, startTime: '08:00', status: 'PRESENT' })]);
    await http().patch(`/api/schedule/${morning}`).set(bearer(owner)).send({ startTime: '09:00', endTime: '10:00' }).expect(200);

    // A one-off lesson: the only lesson of the group that day, so it needs no naming.
    const extraDay = last(3);
    const extra = (await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, date: extraDay, startTime: '11:00', endTime: '12:00', isRecurring: false }).expect(201)).body.id as string;
    await mark(owner, { groupId: g, date: extraDay, entries: [{ studentId: s1, status: 'ABSENT' }, { studentId: s2, status: 'PRESENT' }] }).expect(201);
    expect((await marks(`groupId=${g}&date=${extraDay}`)).map((m) => [m.scheduleId, m.startTime])).toEqual([[extra, '11:00'], [extra, '11:00']]);
    // The lesson is taken off the timetable: what was marked is still there, with its time.
    await http().delete(`/api/schedule/${extra}`).set(bearer(owner)).expect(200);
    expect((await marks(`groupId=${g}&date=${extraDay}`)).map((m) => [m.studentId, m.scheduleId, m.startTime, m.status]).sort()).toEqual([[s1, extra, '11:00', 'ABSENT'], [s2, extra, '11:00', 'PRESENT']].sort());
  });

  it('a lesson that was called off takes no new marks; the other lesson of the day and old marks are untouched', async () => {
    const date = last(6, 2);
    await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s1, status: 'PRESENT' }] }).expect(201);
    const off = (await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: g, date, scheduleId: evening }).expect(201)).body;
    expect((await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(409)).body.code).toBe('LESSON_CANCELLED');
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);
    expect((await marks(`groupId=${g}&date=${date}`)).map((m) => [m.studentId, m.scheduleId, m.status]).sort()).toEqual([[s1, evening, 'PRESENT'], [s2, morning, 'ABSENT']].sort());
    // Put back: it takes marks again.
    await http().delete(`/api/lessons/cancellations/${off.cancellation.id}`).set(bearer(owner)).expect(200);
    await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);
  });

  it('a teacher marks the lessons of their own group, or the one lesson given to them - nothing else', async () => {
    const date = last(6, 3);
    const entries = [{ studentId: s1, status: 'PRESENT' }];
    await mark(t1, { groupId: g, date, scheduleId: morning, entries }).expect(201);
    await mark(t1, { groupId: g, date, scheduleId: evening, entries }).expect(201);
    await mark(t2, { groupId: g, date, scheduleId: evening, entries }).expect(201); // the substitute's own lesson
    await mark(t2, { groupId: g, date, scheduleId: morning, entries }).expect(403);
    await mark(t3, { groupId: g, date, scheduleId: morning, entries }).expect(403);
    await mark(t3, { groupId: g, date, scheduleId: evening, entries }).expect(403);
    await http().get('/api/attendance/unbound').set(bearer(t1)).expect(403);
  });

  it('a day with no timetable lesson gets a day-level mark; an old day-level mark is adopted by the lesson it is then marked for', async () => {
    // Sunday: the group has no lesson.
    const sunday = last(7);
    await mark(owner, { groupId: g, date: sunday, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
    expect(await marks(`groupId=${g}&date=${sunday}`)).toEqual([expect.objectContaining({ scheduleId: null, startTime: null, status: 'ABSENT' })]);

    // An old mark from before lessons were told apart, on a day with two lessons, and its credit.
    const date = last(6, 4);
    const [old] = await db.insert(attendance).values({ tenantId, groupId: g, studentId: s1, date, status: 'ABSENT' }).returning();
    const credit = (await issue({ studentId: s1, groupId: g, date, reason: 'ABSENT' }).expect(201)).body;
    expect(credit.originScheduleId).toBeNull();
    const report = (await http().get('/api/attendance/unbound').set(bearer(owner)).expect(200)).body as { total: number; days: Array<{ groupId: string; date: string; marks: number; lessons: number; reason: string }> };
    expect(report.days.find((d) => d.date === date)).toMatchObject({ groupId: g, marks: 1, lessons: 2, reason: 'SEVERAL' });
    expect(report.days.find((d) => d.date === sunday)).toMatchObject({ marks: 1, lessons: 0, reason: 'NONE' });

    // Someone says which lesson it was: the same row, now that lesson's - and its credit with it.
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
    expect(await marks(`groupId=${g}&date=${date}`)).toEqual([expect.objectContaining({ id: old.id, scheduleId: morning, startTime: '09:00', status: 'ABSENT' })]);
    expect((await credits()).find((c) => c.id === credit.id)).toMatchObject({ status: 'ISSUED', originScheduleId: morning });
    const again = (await http().get('/api/attendance/unbound').set(bearer(owner)).expect(200)).body as typeof report;
    expect(again.days.find((d) => d.date === date)).toBeUndefined();
  });

  it('migration: an old mark is bound when exactly one lesson fits, and left alone when two do; ids and statuses do not change', async () => {
    const single = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'APL Single', subject: 'English', scheduleDays: DAYS[2], startTime: '10:00', endTime: '11:00', maxStudents: 30 }).expect(201)).body.id as string;
    const row = (await db.select().from(schedules).where(eq(schedules.groupId, single)))[0];
    const sx = await student('mig', [single, g]);
    const tue = last(2);
    const sat = last(6, 5);
    const none = last(4); // Thursday: neither group has a lesson
    const inserted = await db.insert(attendance).values([
      { tenantId, groupId: single, studentId: sx, date: tue, status: 'ABSENT' as const },
      { tenantId, groupId: g, studentId: sx, date: sat, status: 'LATE' as const },
      { tenantId, groupId: single, studentId: sx, date: none, status: 'PRESENT' as const },
    ]).returning();
    const [credit] = await db.insert(makeupCredits).values({ tenantId, studentId: sx, originGroupId: single, originDate: tue, reason: 'ABSENT' }).returning();
    const statements = readFileSync(join(__dirname, '..', 'drizzle', '0053_attendance_per_lesson.sql'), 'utf8').split('--> statement-breakpoint');
    const [bind, follow] = statements.slice(-2);
    expect(bind).toContain('UPDATE "attendance"');
    expect(follow).toContain('UPDATE "makeup_credits"');
    await db.execute(sql.raw(bind));
    await db.execute(sql.raw(follow));
    const after = await db.select().from(attendance).where(eq(attendance.studentId, sx));
    const of = (id: string) => after.find((a) => a.id === id)!;
    expect(of(inserted[0].id)).toMatchObject({ scheduleId: row.id, startTime: '10:00', status: 'ABSENT' });
    expect(of(inserted[1].id)).toMatchObject({ scheduleId: null, startTime: null, status: 'LATE' }); // two lessons that Saturday
    expect(of(inserted[2].id)).toMatchObject({ scheduleId: null, status: 'PRESENT' }); // no lesson that Thursday
    expect(after).toHaveLength(3);
    expect((await db.select().from(makeupCredits).where(eq(makeupCredits.id, credit.id)))[0].originScheduleId).toBe(row.id);
    // Running it again changes nothing.
    await db.execute(sql.raw(bind));
    expect(await db.select().from(attendance).where(and(eq(attendance.studentId, sx), eq(attendance.groupId, g)))).toEqual([expect.objectContaining({ id: inserted[1].id, scheduleId: null })]);
  });

  it('two absences of one day earn two credits, each of its own lesson; correcting one mark touches only its credit', async () => {
    const date = last(6, 6);
    const target = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'APL Target', subject: 'English', scheduleDays: DAYS[1], startTime: '06:00', endTime: '07:00', maxStudents: 30 }).expect(201)).body.id as string;
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);
    await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);

    const list = (await http().get(`/api/makeups/eligible?from=${date}&to=${date}`).set(bearer(owner)).expect(200)).body as Array<{ studentId: string; reason: string; scheduleId: string | null; startTime: string | null; credit: unknown }>;
    expect(list.filter((r) => r.studentId === s2).map((r) => [r.reason, r.scheduleId, r.startTime, r.credit]).sort()).toEqual([['ABSENT', morning, '09:00', null], ['ABSENT', evening, '15:00', null]].sort());

    expect((await issue({ studentId: s2, groupId: g, date, reason: 'ABSENT' }).expect(400)).body.code).toBe('LESSON_AMBIGUOUS');
    const cm = (await issue({ studentId: s2, groupId: g, date, reason: 'ABSENT', scheduleId: morning }).expect(201)).body;
    const ce = (await issue({ studentId: s2, groupId: g, date, reason: 'ABSENT', scheduleId: evening }).expect(201)).body;
    expect([cm.originScheduleId, ce.originScheduleId]).toEqual([morning, evening]);
    expect((await issue({ studentId: s2, groupId: g, date, reason: 'ABSENT', scheduleId: morning }).expect(409)).body.code).toBe('DUPLICATE_CREDIT');
    const listed = (await http().get(`/api/makeups/eligible?from=${date}&to=${date}`).set(bearer(owner)).expect(200)).body as Array<{ studentId: string; scheduleId: string | null; credit: { id: string } | null }>;
    expect(listed.filter((r) => r.studentId === s2).map((r) => [r.scheduleId, r.credit?.id]).sort()).toEqual([[morning, cm.id], [evening, ce.id]].sort());

    // Only the morning mark is corrected: only the morning credit goes.
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s2, status: 'PRESENT' }] }).expect(201);
    const state = async (id: string) => (await credits()).find((c) => c.id === id)!;
    expect(await state(cm.id)).toMatchObject({ status: 'CANCELLED', note: 'ATTENDANCE_CORRECTED' });
    expect(await state(ce.id)).toMatchObject({ status: 'ISSUED' });

    // Booked: the correction of that lesson's mark is refused, the other lesson's is not.
    const booking = (await http().post(`/api/makeups/credits/${ce.id}/book`).set(bearer(owner)).send({ mode: 'GROUP_LESSON', targetGroupId: target, date: next(1) }).expect(201)).body;
    expect((await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s2, status: 'PRESENT' }] }).expect(409)).body.code).toBe('CREDIT_BOOKED');
    await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s2, status: 'LATE' }] }).expect(201);
    expect((await marks(`groupId=${g}&date=${date}&scheduleId=${evening}`)).find((m) => m.studentId === s2)!.status).toBe('ABSENT');

    // Used: the make-up happened; a later correction leaves the credit and the booking as history.
    await http().post(`/api/makeups/bookings/${booking.id}/cancel`).set(bearer(owner)).expect(201);
    const past = (await http().post(`/api/makeups/credits/${ce.id}/book`).set(bearer(owner)).send({ mode: 'GROUP_LESSON', targetGroupId: target, date: last(1), historical: true, reason: "O'tgan darsda qatnashgan, kech yozildi" }).expect(201)).body;
    await http().post(`/api/makeups/bookings/${past.id}/attendance`).set(bearer(owner)).send({ status: 'ATTENDED' }).expect(201);
    await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s2, status: 'PRESENT' }] }).expect(201);
    expect(await state(ce.id)).toMatchObject({ status: 'USED' });
  });

  it('a credit and the correction of that lesson\'s absence at once: no credit is left without its absence', async () => {
    for (let round = 0; round < 4; round++) {
      const date = last(6, 8 + round);
      await mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
      await mark(owner, { groupId: g, date, scheduleId: evening, entries: [{ studentId: s1, status: 'ABSENT' }] }).expect(201);
      const other = (await issue({ studentId: s1, groupId: g, date, reason: 'ABSENT', scheduleId: evening }).expect(201)).body;
      const [cr, fix] = await Promise.all([
        issue({ studentId: s1, groupId: g, date, reason: 'ABSENT', scheduleId: morning }),
        mark(owner, { groupId: g, date, scheduleId: morning, entries: [{ studentId: s1, status: 'PRESENT' }] }),
      ]);
      expect(fix.status).toBe(201);
      expect([201, 400]).toContain(cr.status);
      const live = await db.select().from(makeupCredits).where(and(eq(makeupCredits.studentId, s1), eq(makeupCredits.originDate, date), eq(makeupCredits.status, 'ISSUED')));
      // The evening lesson's credit is untouched; the morning one is refused or voided.
      expect(live.map((c) => c.id)).toEqual([other.id]);
    }
  });

  it('a scan marks the lesson that is on (or nearest), once', async () => {
    const today = dateOf(tashkent(0));
    const d = dow(tashkent(0));
    const q = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'APL Scan', subject: 'English', scheduleDays: DAYS[d], startTime: '00:10', endTime: '11:50', maxStudents: 30 }).expect(201)).body.id as string;
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: q, dayOfWeek: d, startTime: '12:00', endTime: '23:50' }).expect(201);
    const rows = (await http().get(`/api/schedule?groupId=${q}`).set(bearer(owner)).expect(200)).body as Array<{ id: string; startTime: string }>;
    const sq = await student('scan', [q]);
    const hourNow = tashkent(0).getUTCHours();
    const expected = rows.find((r) => (hourNow < 12 ? r.startTime === '00:10' : r.startTime === '12:00'))!.id;
    const scans = await Promise.all([0, 1, 2].map(() => http().post('/api/attendance/qr-checkin').set(bearer(owner)).send({ code: `TALIMCRM:STUDENT:${sq}`, groupId: q })));
    expect(scans.every((r) => r.status === 201)).toBe(true);
    const got = await marks(`groupId=${q}&date=${today}`);
    expect(got).toEqual([expect.objectContaining({ studentId: sq, scheduleId: expected, status: 'PRESENT' })]);
  });

  it('back to back: a scan while one lesson is on and the next one opens marks the one on', async () => {
    const now = tashkent(0);
    const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    // Needs 10 minutes before and 40 after within today.
    if (nowMin < 10 || nowMin > 23 * 60 + 10) return;
    const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const today = dateOf(now);
    const d = dow(now);
    // On since 10 minutes, ends in 5; the next starts in 15 (its early window is open).
    const g = (await http().post('/api/groups').set(bearer(owner)).send({ name: 'APL Back to back', subject: 'English', scheduleDays: DAYS[d], startTime: hm(nowMin - 10), endTime: hm(nowMin + 5), maxStudents: 30 }).expect(201)).body.id as string;
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, dayOfWeek: d, startTime: hm(nowMin + 15), endTime: hm(nowMin + 40) }).expect(201);
    const rows = (await http().get(`/api/schedule?groupId=${g}`).set(bearer(owner)).expect(200)).body as Array<{ id: string; startTime: string }>;
    const on = rows.find((r) => r.startTime === hm(nowMin - 10))!.id;
    const sb = await student('back2back', [g]);
    await http().post('/api/attendance/qr-checkin').set(bearer(owner)).send({ code: `TALIMCRM:STUDENT:${sb}`, groupId: g }).expect(201);
    expect(await marks(`groupId=${g}&date=${today}`)).toEqual([expect.objectContaining({ studentId: sb, scheduleId: on, status: 'PRESENT' })]);
  });
});
