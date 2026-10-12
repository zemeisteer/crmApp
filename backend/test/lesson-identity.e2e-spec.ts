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
import { attendance, auditLogs, enrollmentPeriods, enrollments, lessonCancellations, makeupBookings, makeupCredits, schedules } from '../src/db/schema.js';

// A lesson is its timetable row: a make-up stays with the lesson that was
// chosen (never slides into another one), the group form and the timetable
// page apply one rule, a group that goes takes its open make-ups with it
// once, and a credit always rests on something that is still true.
describe('Lesson identity, one write rule, group removal, credit basis (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  // Center-local calendar (Asia/Tashkent, UTC+5, no DST).
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  const next = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i + weeks * 7));
    throw new Error('unreachable');
  };
  const last = (w: number, weeks = 0) => {
    for (let i = 1; i <= 7; i++) if (dow(tashkent(-i)) === w) return dateOf(tashkent(-i - weeks * 7));
    throw new Error('unreachable');
  };
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

  let owner: string, rec: string, tenantId: string;
  let tch: string[] = [];
  let feedPath: string;
  let home: string; // a group whose students collect credits (Sunday 06:00)

  type Row = { id: string; dayOfWeek: number | null; date: string | null; startTime: string; endTime: string; status: string; teacherId: string | null; updatedAt: string };
  type Lesson = { uid: string; date: string; startTime: string; cancelled: boolean; scheduleId: string | null; cancellationId: string | null };
  type Booking = { id: string; status: string; startTime: string; endTime: string; date: string; note: string | null; targetScheduleId: string | null; targetGroupId: string | null };

  let seq = 0;
  const group = (name: string, teacherId: string | null, day: number | number[], start: string, end: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/groups').set(bearer(owner))
      .send({ name: `ID ${name}`, subject: 'English', ...(teacherId ? { teacherId } : {}), scheduleDays: [day].flat().map((d) => DAYS[d]).join(','), startTime: start, endTime: end, maxStudents: 10, ...extra });
  const groupId = async (...a: Parameters<typeof group>) => (await group(...a).expect(201)).body.id as string;
  const student = async (name: string, groupIds: string[]) =>
    (await http().post('/api/students').set(bearer(owner)).send({ fullName: `ID ${name}`, phone: `+9988${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;
  const rows = async (g: string) => (await http().get(`/api/schedule?groupId=${g}`).set(bearer(owner)).expect(200)).body as Row[];
  const lessons = async (g: string, from: string, to = from) => (await http().get(`/api/lessons?from=${from}&to=${to}&groupId=${g}`).set(bearer(owner)).expect(200)).body as Lesson[];
  const addRow = (body: Record<string, unknown>) => http().post('/api/schedule').set(bearer(owner)).send(body);
  const mark = (g: string, studentId: string, date: string, status = 'ABSENT') =>
    http().post('/api/attendance').set(bearer(owner)).send({ groupId: g, date, entries: [{ studentId, status }] });
  const issue = (body: Record<string, unknown>) => http().post('/api/makeups/credits').set(bearer(rec)).send(body);
  /** A fresh credit: the student missed one more Sunday of the home group. */
  const used = new Map<string, number>();
  const credit = async (studentId: string, g = home, weekday = 7) => {
    const n = used.get(studentId + g) ?? 0;
    used.set(studentId + g, n + 1);
    const date = last(weekday, n);
    await mark(g, studentId, date).expect(201);
    return (await issue({ studentId, groupId: g, date, reason: 'ABSENT' }).expect(201)).body.id as string;
  };
  const book = (creditId: string, body: Record<string, unknown>) => http().post(`/api/makeups/credits/${creditId}/book`).set(bearer(rec)).send(body);
  const creditState = async (id: string) => (await http().get('/api/makeups/credits').set(bearer(owner)).expect(200)).body.find((c: { id: string }) => c.id === id) as { status: string; note: string | null; originScheduleId: string | null; bookings: Booking[] };
  const feed = async () => (await http().get(feedPath).expect(200)).text;
  const eventOf = (ics: string, uid: string) => ics.split('BEGIN:VEVENT').find((b) => b.includes(`UID:${uid}@`));

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `ID center ${suffix}`, subdomain: `id-a-${suffix}`, email: `id-a-${suffix}@test.uz`, password: 'password123', fullName: 'Owner ID' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.user.tenantId ?? reg.tenant?.id;
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `id-rec-${suffix}@test.uz`, role: 'RECEPTIONIST' }).expect(201)).body;
    rec = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: 'Rec ID', password: 'password12345' }).expect(201)).body.accessToken;
    for (let i = 0; i < 12; i++) {
      tch.push((await http().post('/api/teachers').set(bearer(owner)).send({ fullName: `ID T${i}`, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id);
    }
    home = await groupId('home', tch[0], 7, '06:00', '07:00', { maxStudents: 100 });
    if (!tenantId) tenantId = (await db.select({ t: schedules.tenantId }).from(schedules).where(eq(schedules.groupId, home)))[0].t;
    const url = (await http().post('/api/calendar/feed').set(bearer(owner)).expect(201)).body.url as string;
    feedPath = new URL(url).pathname;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  // ---- 1. a make-up belongs to the lesson that was chosen -------------------

  describe('a lesson is its timetable row', () => {
    let g: string, morning: Row, evening: Row;
    const sat = () => next(6);

    beforeAll(async () => {
      g = await groupId('two a day', tch[1], 6, '09:00', '10:00');
      await addRow({ groupId: g, dayOfWeek: 6, startTime: '15:00', endTime: '16:00' }).expect(201);
      const all = await rows(g);
      morning = all.find((r) => r.startTime === '09:00')!;
      evening = all.find((r) => r.startTime === '15:00')!;
    });

    it('the 09:00 lesson is deleted: its make-up is cancelled and the credit comes back; the 15:00 lesson gets nothing', async () => {
      const s = await student('del-0900', [home]);
      const c = await credit(s);
      const booked = (await book(c, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat(), scheduleId: morning.id }).expect(201)).body;
      expect(booked).toMatchObject({ startTime: '09:00', targetScheduleId: morning.id });

      const res = (await http().delete(`/api/schedule/${morning.id}`).set(bearer(owner)).expect(200)).body;
      expect(res.makeups).toEqual({ moved: 0, released: 1 });
      const after = await creditState(c);
      expect(after.status).toBe('ISSUED');
      expect(after.bookings).toHaveLength(1);
      expect(after.bookings[0]).toMatchObject({ status: 'CANCELLED', startTime: '09:00', note: 'LESSON_REMOVED' });
      // Nothing was booked into the lesson that is left.
      const live = await db.select().from(makeupBookings).where(and(eq(makeupBookings.targetGroupId, g), eq(makeupBookings.status, 'BOOKED')));
      expect(live).toEqual([]);
      expect((await lessons(g, sat())).map((l) => l.startTime)).toEqual(['15:00']);

      // Put the morning lesson back for the tests below (a new row: a new lesson).
      morning = (await addRow({ groupId: g, dayOfWeek: 6, startTime: '09:00', endTime: '10:00' }).expect(201)).body;
      expect((await creditState(c)).status).toBe('ISSUED');
    });

    it('a lesson keeps its id when its time changes, even past the other lesson; its make-up goes with it', async () => {
      const before = await lessons(g, sat());
      expect(before.map((l) => l.uid)).toEqual([`les-${morning.id}-${sat()}`, `les-${evening.id}-${sat()}`]);
      const s = await student('follow', [home]);
      const c = await credit(s);
      await book(c, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat(), scheduleId: evening.id }).expect(201);

      // The evening lesson becomes the first of the day.
      const res = (await http().patch(`/api/schedule/${evening.id}`).set(bearer(owner)).send({ startTime: '07:00', endTime: '08:00' }).expect(200)).body;
      expect(res.makeups).toEqual({ moved: 1, released: 0 });
      const after = await lessons(g, sat());
      expect(after.map((l) => [l.startTime, l.uid])).toEqual([['07:00', `les-${evening.id}-${sat()}`], ['09:00', `les-${morning.id}-${sat()}`]]);
      expect((await creditState(c)).bookings[0]).toMatchObject({ status: 'BOOKED', startTime: '07:00', endTime: '08:00', targetScheduleId: evening.id });
      const ics = await feed();
      expect(eventOf(ics, `les-${evening.id}-${sat()}`)).toBeDefined();
      expect(eventOf(ics, `les-${morning.id}-${sat()}`)).toBeDefined();

      // Moved to another weekday: no lesson of that row on the booked date any more.
      const gone = (await http().patch(`/api/schedule/${evening.id}`).set(bearer(owner)).send({ dayOfWeek: 5 }).expect(200)).body;
      expect(gone.makeups).toEqual({ moved: 0, released: 1 });
      expect((await creditState(c)).status).toBe('ISSUED');
      await http().patch(`/api/schedule/${evening.id}`).set(bearer(owner)).send({ dayOfWeek: 6, startTime: '15:00', endTime: '16:00' }).expect(200);
    });

    it('one of two lessons is called off: that one only - in the list, the calendar, the make-ups and the credits', async () => {
      const date = next(6, 1);
      const sM = await student('cancel-m', [home]);
      const sE = await student('cancel-e', [home]);
      const cM = await credit(sM);
      const cE = await credit(sE);
      await book(cM, { mode: 'GROUP_LESSON', targetGroupId: g, date, scheduleId: morning.id }).expect(201);
      await book(cE, { mode: 'GROUP_LESSON', targetGroupId: g, date, scheduleId: evening.id }).expect(201);

      const unclear = await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: g, date }).expect(400);
      expect(unclear.body.code).toBe('LESSON_AMBIGUOUS');
      expect(unclear.body.lessons.map((l: { scheduleId: string }) => l.scheduleId).sort()).toEqual([morning.id, evening.id].sort());
      const off = (await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: g, date, scheduleId: morning.id, reason: 'Morning off' }).expect(201)).body;
      expect(off).toMatchObject({ releasedBookings: 1, cancellation: { scheduleId: morning.id } });
      await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: g, date, scheduleId: morning.id }).expect(409);

      expect((await lessons(g, date)).map((l) => [l.startTime, l.cancelled])).toEqual([['09:00', true], ['15:00', false]]);
      expect((await creditState(cM)).status).toBe('ISSUED');
      expect((await creditState(cE)).bookings[0]).toMatchObject({ status: 'BOOKED', startTime: '15:00' });
      const ics = await feed();
      expect(eventOf(ics, `les-${morning.id}-${date}`)).toContain('STATUS:CANCELLED');
      expect(eventOf(ics, `les-${evening.id}-${date}`)).not.toContain('STATUS:CANCELLED');
      // The cancelled lesson takes no make-up; the other one still does.
      expect((await book(cM, { mode: 'GROUP_LESSON', targetGroupId: g, date, scheduleId: morning.id }).expect(400)).body.code).toBe('NO_LESSON');

      // A student of the group gets a credit for the lesson that was called off - that one.
      const own = await student('own', [g]);
      const c = (await issue({ studentId: own, groupId: g, date, reason: 'LESSON_CANCELLED' }).expect(201)).body;
      expect(c.originScheduleId).toBe(morning.id);
      expect((await issue({ studentId: own, groupId: g, date, reason: 'LESSON_CANCELLED', scheduleId: morning.id }).expect(409)).body.code).toBe('DUPLICATE_CREDIT');
      expect((await issue({ studentId: own, groupId: g, date, reason: 'LESSON_CANCELLED', scheduleId: evening.id }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
      expect((await http().delete(`/api/lessons/cancellations/${off.cancellation.id}`).set(bearer(owner)).expect(409)).body.code).toBe('CREDITS_ISSUED');
      await http().post(`/api/makeups/credits/${c.id}/cancel`).set(bearer(owner)).expect(201);
      await http().delete(`/api/lessons/cancellations/${off.cancellation.id}`).set(bearer(owner)).expect(200);
      expect((await lessons(g, date)).every((l) => !l.cancelled)).toBe(true);
      // Restoring the lesson does not bring the released booking back.
      expect((await creditState(cM)).bookings.filter((b) => b.status === 'BOOKED')).toEqual([]);
    });

    it('the group form keeps the rows: a new name rebuilds nothing, a new time moves the lesson in place', async () => {
      const f = await groupId('form keeps', tch[2], [1, 3], '09:00', '10:00');
      const before = await rows(f);
      await http().patch(`/api/groups/${f}`).set(bearer(owner)).send({ name: 'ID form renamed', description: 'x', scheduleDays: `${DAYS[1]},${DAYS[3]}`, startTime: '09:00', endTime: '10:00' }).expect(200);
      // Same rows, untouched (not even their updatedAt).
      const stamp = (list: Row[]) => list.map((r) => [r.id, r.dayOfWeek, r.startTime, r.endTime, r.updatedAt]).sort();
      expect(stamp(await rows(f))).toEqual(stamp(before));

      // Wednesday gets its own time on the timetable; the form does not flatten it.
      const wed = before.find((r) => r.dayOfWeek === 3)!;
      await http().patch(`/api/schedule/${wed.id}`).set(bearer(owner)).send({ startTime: '11:00', endTime: '12:00' }).expect(200);
      await http().patch(`/api/groups/${f}`).set(bearer(owner)).send({ name: 'ID form renamed again', scheduleDays: `${DAYS[1]},${DAYS[3]}`, startTime: '09:00', endTime: '10:00' }).expect(200);
      expect((await rows(f)).map((r) => [r.id, r.dayOfWeek, r.startTime]).sort()).toEqual(before.map((r) => [r.id, r.dayOfWeek, r.dayOfWeek === 3 ? '11:00' : '09:00']).sort());

      // The form's time changes: the lesson that had the form's time moves, same row.
      const s = await student('form-follow', [home]);
      const c = await credit(s);
      const mon = before.find((r) => r.dayOfWeek === 1)!;
      await book(c, { mode: 'GROUP_LESSON', targetGroupId: f, date: next(1), scheduleId: mon.id }).expect(201);
      const saved = (await http().patch(`/api/groups/${f}`).set(bearer(owner)).send({ startTime: '10:00', endTime: '11:00' }).expect(200)).body;
      expect(saved.makeups).toEqual({ moved: 1, released: 0 });
      expect((await rows(f)).map((r) => [r.id, r.startTime]).sort()).toEqual([[mon.id, '10:00'], [wed.id, '11:00']].sort());
      expect((await creditState(c)).bookings[0]).toMatchObject({ status: 'BOOKED', startTime: '10:00', targetScheduleId: mon.id });

      // A day taken off the form: that lesson goes, and its make-up is released.
      const off = (await http().patch(`/api/groups/${f}`).set(bearer(owner)).send({ scheduleDays: DAYS[3] }).expect(200)).body;
      expect(off.makeups).toEqual({ moved: 0, released: 1 });
      expect((await rows(f)).map((r) => r.id)).toEqual([wed.id]);
      expect((await creditState(c)).status).toBe('ISSUED');
    });

    it('migration: an open booking is bound only when exactly one lesson matches; a doubtful one is left alone', async () => {
      const m = await groupId('migrate', tch[3], 2, '09:00', '10:00');
      const only = (await rows(m))[0];
      const date = next(2);
      const s1 = await student('mig-1', [home]);
      const s2 = await student('mig-2', [home]);
      const c1 = await credit(s1);
      const c2 = await credit(s2);
      const b1 = (await book(c1, { mode: 'GROUP_LESSON', targetGroupId: m, date }).expect(201)).body;
      const b2 = (await book(c2, { mode: 'GROUP_LESSON', targetGroupId: m, date }).expect(201)).body;
      // As before the migration: no lesson recorded on the bookings; the second one now has two candidates.
      await db.update(makeupBookings).set({ targetScheduleId: null }).where(eq(makeupBookings.targetGroupId, m));
      await addRow({ groupId: m, dayOfWeek: 2, startTime: '09:00', endTime: '10:00', allowCollision: true }).expect(201);
      const statements = readFileSync(join(__dirname, '..', 'drizzle', '0051_lesson_identity.sql'), 'utf8').split('--> statement-breakpoint');
      const backfill = statements[statements.length - 1];
      expect(backfill).toContain('UPDATE "makeup_bookings"');
      await db.execute(sql.raw(backfill));
      const after = await db.select({ id: makeupBookings.id, target: makeupBookings.targetScheduleId, status: makeupBookings.status }).from(makeupBookings).where(eq(makeupBookings.targetGroupId, m));
      // Two rows at 09:00 on Tuesday: neither booking is guessed into one of them.
      expect(after.map((b) => b.target)).toEqual([null, null]);
      expect(after.every((b) => b.status === 'BOOKED')).toBe(true);

      // With one candidate left the same statement binds them.
      const extra = (await rows(m)).find((r) => r.id !== only.id)!;
      await db.delete(schedules).where(eq(schedules.id, extra.id));
      await db.execute(sql.raw(backfill));
      const bound = await db.select({ id: makeupBookings.id, target: makeupBookings.targetScheduleId }).from(makeupBookings).where(eq(makeupBookings.targetGroupId, m));
      expect(bound.map((b) => b.target)).toEqual([only.id, only.id]);
      expect([b1.id, b2.id].sort()).toEqual(bound.map((b) => b.id).sort());
    });
  });

  // ---- 2. one write rule for the group form and the timetable --------------

  describe('the group form and the timetable page decide alike', () => {
    it('the same change is refused the same way from both, and a refused group save leaves nothing behind', async () => {
      const wed = next(3);
      // The teacher is taken by a make-up session next Wednesday 10:00.
      const s = await student('session', [home]);
      const c = await credit(s);
      await book(c, { mode: 'SESSION', date: wed, startTime: '10:00', endTime: '11:00', teacherId: tch[4] }).expect(201);
      const x = await groupId('rule', tch[5], 1, '08:00', '09:00');

      const fromTimetable = await addRow({ groupId: x, teacherId: tch[4], dayOfWeek: 3, startTime: '10:00', endTime: '11:00' }).expect(409);
      const fromForm = await http().patch(`/api/groups/${x}`).set(bearer(owner))
        .send({ name: 'ID rule renamed', teacherId: tch[4], scheduleDays: DAYS[3], startTime: '10:00', endTime: '11:00' }).expect(409);
      const types = (r: { body: { conflicts: Array<{ type: string }> } }) => r.body.conflicts.map((k) => k.type).sort();
      expect(types(fromForm)).toEqual(types(fromTimetable));
      expect(types(fromForm)).toEqual(['MAKEUP']);
      // Nothing of the refused save stayed: not the name, not the teacher, not the rows.
      const g = (await http().get(`/api/groups/${x}`).set(bearer(owner)).expect(200)).body;
      expect(g).toMatchObject({ name: 'ID rule', teacherId: tch[5], scheduleDays: DAYS[1], startTime: '08:00' });
      expect((await rows(x)).map((r) => [r.dayOfWeek, r.startTime, r.teacherId])).toEqual([[1, '08:00', tch[5]]]);
      // A new group in that slot is refused as well.
      expect((await group('rule new', tch[4], 3, '10:30', '11:30').expect(409)).body.conflicts.map((k: { type: string }) => k.type)).toEqual(['MAKEUP']);
    });

    it('a student in two groups: the form cannot move one group onto the other', async () => {
      const a = await groupId('share a', tch[6], 4, '09:00', '10:00');
      const b = await groupId('share b', tch[7], 4, '11:00', '12:00');
      await student('shared', [a, b]);
      const res = await http().patch(`/api/groups/${b}`).set(bearer(owner)).send({ startTime: '09:30', endTime: '10:30' }).expect(409);
      expect(res.body.code).toBe('SCHEDULE_CONFLICT');
      expect(res.body.conflicts[0]).toMatchObject({ type: 'STUDENT', studentCount: 1 });
      expect((await rows(b))[0].startTime).toBe('11:00');
      // The same teacher in another group at that time: the code the form already knows.
      expect((await http().patch(`/api/groups/${b}`).set(bearer(owner)).send({ teacherId: tch[6], startTime: '09:00', endTime: '10:00' }).expect(409)).body.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    });

    it('two groups created at once for one teacher at one time: one of them', async () => {
      for (let round = 0; round < 3; round++) {
        const start = `1${round}:00`;
        const res = await Promise.all([0, 1, 2].map((i) => group(`race ${round}-${i}`, tch[8], 5, start, `1${round}:50`)));
        expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      }
      const all = (await http().get('/api/schedule').set(bearer(owner)).expect(200)).body as Row[];
      expect(all.filter((r) => r.teacherId === tch[8] && r.dayOfWeek === 5)).toHaveLength(3);
    });

    it('a lesson called off frees its time that day - and cannot come back onto what took it', async () => {
      const k = await groupId('freed', tch[9], 1, '09:00', '10:00');
      const row = (await rows(k))[0];
      const mon = next(1);
      const later = next(1, 1);
      const s = await student('freed', [home]);
      const c = await credit(s);
      // The teacher teaches then: no session.
      expect((await book(c, { mode: 'SESSION', date: mon, startTime: '09:00', endTime: '10:00', teacherId: tch[9] }).expect(409)).body.code).toBe('SLOT_TAKEN');
      const off = (await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: k, date: mon, scheduleId: row.id }).expect(201)).body;
      await book(c, { mode: 'SESSION', date: mon, startTime: '09:00', endTime: '10:00', teacherId: tch[9] }).expect(201);
      // The week after, the lesson is on: still taken.
      const c2 = await credit(s);
      expect((await book(c2, { mode: 'SESSION', date: later, startTime: '09:00', endTime: '10:00', teacherId: tch[9] }).expect(409)).body.code).toBe('SLOT_TAKEN');
      // A one-off lesson fits into the freed hour too.
      const other = await groupId('freed other', null, 2, '13:00', '14:00');
      await addRow({ groupId: other, teacherId: tch[9], date: mon, startTime: '09:00', endTime: '10:00', isRecurring: false }).expect(409); // the session holds it now
      const back = await http().delete(`/api/lessons/cancellations/${off.cancellation.id}`).set(bearer(owner)).expect(409);
      expect(back.body.code).toBe('RESTORE_CONFLICT');
      expect((await lessons(k, mon))[0].cancelled).toBe(true);
    });

    it('a finished group holds nothing up; it comes back only if its time is still free', async () => {
      const old = await groupId('finished', tch[10], 2, '16:00', '17:00');
      expect((await group('successor', tch[10], 2, '16:00', '17:00').expect(409)).body.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      const s = await student('into finished', [home]);
      const c = await credit(s);
      await book(c, { mode: 'GROUP_LESSON', targetGroupId: old, date: next(2) }).expect(201);
      const closed = (await http().patch(`/api/groups/${old}`).set(bearer(owner)).send({ status: 'ARCHIVED' }).expect(200)).body;
      expect(closed.makeups).toEqual({ moved: 0, released: 1 });
      expect(await creditState(c)).toMatchObject({ status: 'ISSUED', bookings: [expect.objectContaining({ status: 'CANCELLED', note: 'GROUP_CLOSED' })] });
      await group('successor', tch[10], 2, '16:00', '17:00').expect(201);
      const reopened = await http().patch(`/api/groups/${old}`).set(bearer(owner)).send({ status: 'ACTIVE' }).expect(409);
      expect(reopened.body.code).toBe('TEACHER_SCHEDULE_CONFLICT');
      expect((await http().get(`/api/groups/${old}`).set(bearer(owner)).expect(200)).body.status).toBe('ARCHIVED');
    });
  });

  // ---- 3. a group that is deleted, and restored ----------------------------

  describe('deleting and restoring a group', () => {
    it('open make-ups are released once, history stays, the calendar forgets the lessons, and it is audited', async () => {
      const d = await groupId('to delete', tch[11], 3, '18:00', '19:00');
      const row = (await rows(d))[0];
      const sPast = await student('del-past', [home]);
      const sOpen = await student('del-open', [home]);
      const cPast = await credit(sPast);
      const cOpen = await credit(sOpen);
      const past = (await book(cPast, { mode: 'GROUP_LESSON', targetGroupId: d, date: last(3) }).expect(201)).body;
      await http().post(`/api/makeups/bookings/${past.id}/attendance`).set(bearer(owner)).send({ status: 'ATTENDED' }).expect(201);
      await book(cOpen, { mode: 'GROUP_LESSON', targetGroupId: d, date: next(3) }).expect(201);
      expect(eventOf(await feed(), `les-${row.id}-${next(3)}`)).toBeDefined();

      const res = (await http().delete(`/api/groups/${d}`).set(bearer(owner)).expect(200)).body;
      expect(res).toEqual({ success: true, makeups: { moved: 0, released: 1 } });
      expect(await creditState(cOpen)).toMatchObject({ status: 'ISSUED', bookings: [expect.objectContaining({ status: 'CANCELLED', note: 'GROUP_REMOVED' })] });
      expect(await creditState(cPast)).toMatchObject({ status: 'USED', bookings: [expect.objectContaining({ status: 'ATTENDED' })] });
      const ics = await feed();
      expect(eventOf(ics, `les-${row.id}-${next(3)}`)).toBeUndefined();
      await http().delete(`/api/groups/${d}`).set(bearer(owner)).expect(404);
      await book(cOpen, { mode: 'GROUP_LESSON', targetGroupId: d, date: next(3) }).expect(404);
      await new Promise((r) => setTimeout(r, 300));
      const logged = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'group'), eq(auditLogs.entityId, d), eq(auditLogs.action, 'delete')));
      expect(JSON.parse(logged[0].meta!)).toMatchObject({ releasedMakeups: 1 });

      // Meanwhile another group took the teacher's hour: no way back onto it.
      const taker = await groupId('taker', tch[11], 3, '18:30', '19:30');
      const refused = await http().post(`/api/groups/${d}/restore`).set(bearer(owner)).expect(409);
      expect(refused.body.code).toBe('RESTORE_CONFLICT');
      expect(refused.body.conflicts[0].type).toBe('TEACHER');
      expect((await http().get('/api/groups/trash').set(bearer(owner)).expect(200)).body.map((x: { id: string }) => x.id)).toContain(d);
      // Free again: it comes back - and the released make-up stays cancelled.
      await http().delete(`/api/groups/${taker}`).set(bearer(owner)).expect(200);
      await http().post(`/api/groups/${d}/restore`).set(bearer(owner)).expect(201);
      expect((await lessons(d, next(3))).map((l) => l.uid)).toEqual([`les-${row.id}-${next(3)}`]);
      const state = await creditState(cOpen);
      expect(state.status).toBe('ISSUED');
      expect(state.bookings.filter((b) => b.status === 'BOOKED')).toEqual([]);
    });

    it('a booking and the deletion at the same moment: never a live make-up in a deleted group', async () => {
      for (let round = 0; round < 4; round++) {
        const d = await groupId(`race del ${round}`, null, 4, '20:00', '21:00');
        const s = await student(`race-del-${round}`, [home]);
        const c = await credit(s);
        const [b, del] = await Promise.all([
          book(c, { mode: 'GROUP_LESSON', targetGroupId: d, date: next(4) }),
          http().delete(`/api/groups/${d}`).set(bearer(owner)),
        ]);
        expect(del.status).toBe(200);
        expect([201, 404]).toContain(b.status);
        const live = await db.select().from(makeupBookings).where(and(eq(makeupBookings.targetGroupId, d), eq(makeupBookings.status, 'BOOKED')));
        expect(live).toEqual([]);
        const state = await creditState(c);
        expect(state.status).toBe('ISSUED');
        // Booked first and then released by the deletion, or refused: at most one booking, never two releases.
        expect(state.bookings.length).toBeLessThanOrEqual(1);

        // A restore and a booking together: the booking lands in a live group or is refused.
        const [r2, b2] = await Promise.all([
          http().post(`/api/groups/${d}/restore`).set(bearer(owner)),
          book(c, { mode: 'GROUP_LESSON', targetGroupId: d, date: next(4) }),
        ]);
        expect(r2.status).toBe(201);
        expect([201, 404]).toContain(b2.status);
        expect((await creditState(c)).status).toBe(b2.status === 201 ? 'BOOKED' : 'ISSUED');
      }
    });
  });

  // ---- 4. what a credit rests on --------------------------------------------

  describe('a credit has a basis that is still true', () => {
    it('a credit and the restore of the cancelled lesson at once: one of them', async () => {
      const k = await groupId('basis', null, 5, '06:00', '07:00');
      const s = await student('basis', [k]);
      for (let round = 0; round < 4; round++) {
        const date = next(5, round);
        const off = (await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: k, date }).expect(201)).body;
        const [cr, back] = await Promise.all([
          issue({ studentId: s, groupId: k, date, reason: 'LESSON_CANCELLED' }),
          http().delete(`/api/lessons/cancellations/${off.cancellation.id}`).set(bearer(owner)),
        ]);
        const cancelled = (await db.select().from(lessonCancellations).where(and(eq(lessonCancellations.groupId, k), eq(lessonCancellations.date, date)))).length === 1;
        const live = (await db.select().from(makeupCredits).where(and(eq(makeupCredits.originGroupId, k), eq(makeupCredits.originDate, date), eq(makeupCredits.status, 'ISSUED')))).length;
        // Either the credit and a lesson still called off, or the lesson back and no credit.
        expect([[201, 409], [400, 200]]).toContainEqual([cr.status, back.status]);
        expect(live).toBe(cancelled ? 1 : 0);
        expect(cr.status === 201).toBe(cancelled);
      }
    });

    it('an absence corrected while its credit is being issued: no credit is left without the absence', async () => {
      const s = await student('corrected', [home]);
      for (let round = 0; round < 4; round++) {
        const date = last(7, 10 + round);
        await mark(home, s, date).expect(201);
        const [cr, fix] = await Promise.all([
          issue({ studentId: s, groupId: home, date, reason: 'ABSENT' }),
          mark(home, s, date, 'PRESENT'),
        ]);
        expect(fix.status).toBe(201);
        const [row] = await db.select().from(attendance).where(and(eq(attendance.studentId, s), eq(attendance.groupId, home), eq(attendance.date, date)));
        expect(row.status).toBe('PRESENT');
        const credits = await db.select().from(makeupCredits).where(and(eq(makeupCredits.studentId, s), eq(makeupCredits.originDate, date)));
        // Refused, or issued a moment earlier and voided by the correction.
        expect([201, 400]).toContain(cr.status);
        expect(credits.filter((c) => c.status !== 'CANCELLED')).toEqual([]);
        if (cr.status === 201) expect(credits[0]).toMatchObject({ status: 'CANCELLED', note: 'ATTENDANCE_CORRECTED' });
      }
    });

    it('a booked credit stops the correction of its absence; the other marks of that save are not written either', async () => {
      const s = await student('booked-basis', [home]);
      const other = await student('booked-other', [home]);
      const date = last(7, 20);
      await mark(home, s, date).expect(201);
      const c = (await issue({ studentId: s, groupId: home, date, reason: 'ABSENT' }).expect(201)).body.id;
      const tgt = await groupId('basis target', null, 1, '05:00', '06:00');
      await book(c, { mode: 'GROUP_LESSON', targetGroupId: tgt, date: next(1) }).expect(201);
      const res = await http().post('/api/attendance').set(bearer(owner))
        .send({ groupId: home, date, entries: [{ studentId: other, status: 'LATE' }, { studentId: s, status: 'PRESENT' }] }).expect(409);
      expect(res.body.code).toBe('CREDIT_BOOKED');
      const marks = await db.select().from(attendance).where(and(eq(attendance.groupId, home), eq(attendance.date, date)));
      expect(marks.map((m) => [m.studentId, m.status])).toEqual([[s, 'ABSENT']]);
      expect((await creditState(c)).status).toBe('BOOKED');
    });

    it('who was in the group that day is decided on the center clock, by the list and by the API alike', async () => {
      const k = await groupId('membership', null, 3, '04:00', '05:00');
      const date = last(3);
      const [y, m, d] = date.split('-').map(Number);
      const utc = (day: number, hour: number, min = 0) => new Date(Date.UTC(y, m - 1, d + day, hour, min));
      const stayed = await student('stayed', [k]);
      const leftBefore = await student('left-before', [k]);
      const leftAfterMidnight = await student('left-after', [k]);
      const joinedNextDay = await student('joined-late', [k]);
      // The enrollment row and the stay it stands for (enrollment_periods is what the rules read).
      const set = async (studentId: string, v: { joinedAt: Date; status?: string; leftAt?: Date }) => {
        await db.update(enrollments).set(v).where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, k)));
        await db.update(enrollmentPeriods).set({ startedAt: v.joinedAt, ...(v.leftAt ? { endedAt: v.leftAt, endReason: 'LEFT_GROUP' } : {}) })
          .where(and(eq(enrollmentPeriods.studentId, studentId), eq(enrollmentPeriods.groupId, k)));
      };
      for (const s of [stayed, leftBefore, leftAfterMidnight, joinedNextDay]) await mark(k, s, date).expect(201);
      await set(stayed, { joinedAt: utc(-30, 6) });
      // Left the evening before the lesson (18:30 UTC two days earlier is still an earlier day in Tashkent).
      await set(leftBefore, { joinedAt: utc(-30, 6), status: 'CANCELLED', leftAt: utc(-1, 12) });
      // Left at 00:30 Tashkent time the day AFTER the lesson - 19:30 UTC on the lesson day.
      await set(leftAfterMidnight, { joinedAt: utc(-30, 6), status: 'CANCELLED', leftAt: utc(0, 19, 30) });
      // Joined at 01:00 Tashkent time the day after - 20:00 UTC on the lesson day.
      await set(joinedNextDay, { joinedAt: utc(0, 20) });
      await db.insert(lessonCancellations).values({ tenantId, groupId: k, date, scheduleId: (await rows(k))[0].id });

      const list = (await http().get(`/api/makeups/eligible?from=${date}&to=${date}`).set(bearer(rec)).expect(200)).body as Array<{ studentId: string; reason: string }>;
      const got = (reason: string) => list.filter((r) => r.reason === reason && [stayed, leftBefore, leftAfterMidnight, joinedNextDay].includes(r.studentId)).map((r) => r.studentId).sort();
      // Absent marks: everyone who had not left by that day (the mark is the evidence, also for the one entered later).
      expect(got('ABSENT')).toEqual([stayed, leftAfterMidnight, joinedNextDay].sort());
      // The cancelled lesson: only those in the group that day.
      expect(got('LESSON_CANCELLED')).toEqual([stayed, leftAfterMidnight].sort());

      const can = async (studentId: string, reason: string) => {
        const r = await issue({ studentId, groupId: k, date, reason });
        if (r.status === 201) await http().post(`/api/makeups/credits/${r.body.id}/cancel`).set(bearer(owner)).expect(201);
        return r.status === 201 ? true : r.body.code;
      };
      expect(await can(stayed, 'ABSENT')).toBe(true);
      expect(await can(leftBefore, 'ABSENT')).toBe('NOT_ELIGIBLE');
      expect(await can(leftAfterMidnight, 'ABSENT')).toBe(true);
      expect(await can(joinedNextDay, 'ABSENT')).toBe(true);
      expect(await can(stayed, 'LESSON_CANCELLED')).toBe(true);
      expect(await can(leftBefore, 'LESSON_CANCELLED')).toBe('NOT_ELIGIBLE');
      expect(await can(leftAfterMidnight, 'LESSON_CANCELLED')).toBe(true);
      expect(await can(joinedNextDay, 'LESSON_CANCELLED')).toBe('NOT_ELIGIBLE');
      // Straight to the API with nothing behind it.
      expect((await issue({ studentId: stayed, groupId: k, date: last(3, 1), reason: 'ABSENT' }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
      expect((await issue({ studentId: stayed, groupId: k, date: last(3, 1), reason: 'LESSON_CANCELLED' }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
    });
  });
});
