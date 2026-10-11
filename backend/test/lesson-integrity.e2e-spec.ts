import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { groups, schedules } from '../src/db/schema.js';

// Lessons, the timetable and make-ups as one thing: a lesson called off
// stays off everywhere, a clash is seen from both sides, a make-up follows
// the lesson it was booked into, races have one winner, and a question
// about clashes tells nobody more than they may know.
describe('Lessons, timetable and make-ups together (e2e)', () => {
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

  let ownerA: string, managerA: string, recA: string, t1: string, t2: string, ownerB: string;
  let tch1: string, tch2: string, tch3: string, room: string, groupOfB: string;
  let feedPath: string;

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `LI ${key} ${suffix}`, subdomain: `li-${key}-${suffix}`, email: `li-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const invite = async (owner: string, role: string, local: string) => {
    const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `li-${local}-${suffix}@test.uz`, role }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `${role} ${local}`, password: 'password12345' }).expect(201)).body;
    return { token: acc.accessToken as string, userId: acc.user.id as string };
  };
  let seq = 0;
  const group = async (name: string, teacherId: string, day: number | number[], start: string, end: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/groups').set(bearer(ownerA))
      .send({ name: `LI ${name}`, subject: 'English', teacherId, scheduleDays: [day].flat().map((d) => DAYS[d]).join(','), startTime: start, endTime: end, maxStudents: 10, ...extra })
      .expect(201)).body.id as string;
  const student = async (name: string, groupIds: string[]) =>
    (await http().post('/api/students').set(bearer(ownerA)).send({ fullName: `LI ${name}`, phone: `+9989${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;
  const rows = async (groupId: string) => (await http().get(`/api/schedule?groupId=${groupId}`).set(bearer(ownerA)).expect(200)).body as Array<{ id: string; dayOfWeek: number | null; date: string | null; startTime: string; status: string }>;
  const lessons = async (groupId: string, from = dateOf(tashkent(1)), to = dateOf(tashkent(14))) =>
    (await http().get(`/api/lessons?from=${from}&to=${to}&groupId=${groupId}`).set(bearer(ownerA)).expect(200)).body as Array<{ uid: string; date: string; startTime: string; cancelled: boolean; kind: string }>;
  const feed = async () => (await http().get(feedPath).expect(200)).text;
  const absent = (groupId: string, studentId: string, date: string) =>
    http().post('/api/attendance').set(bearer(ownerA)).send({ groupId, date, entries: [{ studentId, status: 'ABSENT' }] }).expect(201);
  /** A fresh, unused credit of this student (one per missed lesson of the group, going back week by week). */
  const used = new Map<string, number>();
  const credit = async (studentId: string, groupId: string, weekday: number) => {
    const n = used.get(studentId + groupId) ?? 0;
    used.set(studentId + groupId, n + 1);
    const date = last(weekday, n);
    await absent(groupId, studentId, date);
    return (await http().post('/api/makeups/credits').set(bearer(recA)).send({ studentId, groupId, date, reason: 'ABSENT' }).expect(201)).body.id as string;
  };
  const book = (token: string, creditId: string, body: Record<string, unknown>) => http().post(`/api/makeups/credits/${creditId}/book`).set(bearer(token)).send(body);
  const creditState = async (id: string) => (await http().get('/api/makeups/credits').set(bearer(ownerA)).expect(200)).body.find((c: { id: string }) => c.id === id) as { status: string; bookings: Array<{ id: string; status: string; startTime: string; endTime: string; date: string; note: string | null }> };
  const check = (token: string, body: Record<string, unknown>) => http().post('/api/schedule/check-conflict').set(bearer(token)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    ownerA = await register('a');
    managerA = (await invite(ownerA, 'MANAGER', 'mgr')).token;
    recA = (await invite(ownerA, 'RECEPTIONIST', 'rec')).token;
    const u1 = await invite(ownerA, 'TEACHER', 't1'); t1 = u1.token;
    const u2 = await invite(ownerA, 'TEACHER', 't2'); t2 = u2.token;
    const mk = async (name: string, userId?: string) => (await http().post('/api/teachers').set(bearer(ownerA)).send({ fullName: name, userId, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id as string;
    tch1 = await mk('LI T1', u1.userId);
    tch2 = await mk('LI T2', u2.userId);
    tch3 = await mk('LI T3');
    room = (await http().post('/api/schedule/rooms').set(bearer(ownerA)).send({ name: 'LI Room', capacity: 6 }).expect(201)).body.id;
    ownerB = await register('b');
    groupOfB = (await http().post('/api/groups').set(bearer(ownerB)).send({ name: 'LI other center', subject: 'English', scheduleDays: 'Dushanba', startTime: '10:00', endTime: '11:00', maxStudents: 10 }).expect(201)).body.id;
    const url = (await http().post('/api/calendar/feed').set(bearer(ownerA)).expect(201)).body.url as string;
    feedPath = new URL(url).pathname;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  // ---- 1. a lesson that was called off stays off ---------------------------

  describe('which groups have weekly lessons', () => {
    let legacy: string, cancelledAll: string, mixed: string, deleted: string;

    beforeAll(async () => {
      legacy = await group('legacy', tch3, 2, '07:00', '08:00');
      cancelledAll = await group('all cancelled', tch3, 4, '07:00', '08:00');
      mixed = await group('mixed', tch3, [1, 5], '07:00', '08:00');
      deleted = await group('deleted row', tch3, 6, '07:00', '08:00');
      // A group from before the timetable had weekly rows: none at all.
      await db.delete(schedules).where(eq(schedules.groupId, legacy));
      await db.update(groups).set({ timetableManaged: false }).where(eq(groups.id, legacy));
      for (const r of await rows(cancelledAll)) await http().patch(`/api/schedule/${r.id}`).set(bearer(ownerA)).send({ status: 'CANCELLED' }).expect(200);
      const friday = (await rows(mixed)).find((r) => r.dayOfWeek === 5)!;
      await http().patch(`/api/schedule/${friday.id}`).set(bearer(ownerA)).send({ status: 'CANCELLED' }).expect(200);
      for (const r of await rows(deleted)) await http().delete(`/api/schedule/${r.id}`).set(bearer(ownerA)).expect(200);
    }, 60_000);

    it('an old group with no timetable row at all keeps the days of its own form', async () => {
      const list = await lessons(legacy);
      expect(list.map((l) => l.date)).toEqual([next(2), next(2, 1)].sort());
      expect(list.every((l) => l.startTime === '07:00' && !l.cancelled)).toBe(true);
    });

    it('a group whose weekly rows are all cancelled has no lesson: the form days do not bring it back', async () => {
      expect((await rows(cancelledAll)).every((r) => r.status === 'CANCELLED')).toBe(true);
      expect(await lessons(cancelledAll)).toEqual([]);
    });

    it('with live and cancelled rows side by side, only the live weekday has lessons', async () => {
      const list = await lessons(mixed);
      expect(list.map((l) => l.date)).toEqual([next(1), next(1, 1)].sort());
    });

    it('a group whose only weekly row was deleted from the timetable has no lesson either', async () => {
      expect(await rows(deleted)).toEqual([]);
      expect(await lessons(deleted)).toEqual([]);
    });

    it('a one-off lesson and a date called off: each is cancelled on its own', async () => {
      const g = await group('one-off', tch3, 3, '07:00', '08:00');
      const wed = next(3);
      const tue = next(2);
      const oneOff = (await http().post('/api/schedule').set(bearer(ownerA)).send({ groupId: g, date: tue, startTime: '19:00', endTime: '20:00', isRecurring: false }).expect(201)).body.id as string;
      await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g, date: wed }).expect(201);
      let list = await lessons(g, dateOf(tashkent(1)), dateOf(tashkent(7)));
      // The weekly lesson of that date is shown as cancelled; the one-off is untouched.
      expect(list.find((l) => l.date === wed)).toMatchObject({ kind: 'WEEKLY', cancelled: true });
      expect(list.find((l) => l.uid === `one-${oneOff}`)).toMatchObject({ date: tue, kind: 'ONE_OFF', cancelled: false });
      // The one-off is called off through its own row, and is then gone.
      await http().patch(`/api/schedule/${oneOff}`).set(bearer(ownerA)).send({ status: 'CANCELLED' }).expect(200);
      list = await lessons(g, dateOf(tashkent(1)), dateOf(tashkent(7)));
      expect(list.find((l) => l.uid === `one-${oneOff}`)).toBeUndefined();
      // A date with no weekly lesson cannot be called off.
      await http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: g, date: next(4) }).expect(400);
    });

    it('the lessons list, the calendar feed and make-up booking agree on every one of them', async () => {
      const ics = await feed();
      // A lesson's id: its timetable row and the date; a group with no rows, the group and the date.
      const inFeed = async (g: string, date: string) => {
        const rows = (await http().get(`/api/schedule?groupId=${g}`).set(bearer(ownerA)).expect(200)).body as { id: string }[];
        return [`grp-${g}-${date}`, ...rows.map((r) => `les-${r.id}-${date}`)].some((uid) => ics.includes(`UID:${uid}@`));
      };
      expect(await inFeed(legacy, next(2))).toBe(true);
      expect(await inFeed(mixed, next(1))).toBe(true);
      expect(await inFeed(mixed, next(5))).toBe(false);
      expect(await inFeed(cancelledAll, next(4))).toBe(false);
      expect(await inFeed(deleted, next(6))).toBe(false);

      // A make-up can be booked exactly where a lesson is.
      const home = await group('home', tch1, 7, '20:00', '21:00');
      const s = await student('Feed Student', [home]);
      const tryBook = async (g: string, date: string) => {
        const c = await credit(s, home, 7);
        const res = await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: g, date });
        if (res.status === 201) await http().post(`/api/makeups/bookings/${res.body.id}/cancel`).set(bearer(recA)).expect(201);
        return res.status === 201 ? 'booked' : res.body.code;
      };
      expect(await tryBook(legacy, next(2))).toBe('booked');
      expect(await tryBook(mixed, next(1))).toBe('booked');
      expect(await tryBook(mixed, next(5))).toBe('NO_LESSON');
      expect(await tryBook(cancelledAll, next(4))).toBe('NO_LESSON');
      expect(await tryBook(deleted, next(6))).toBe('NO_LESSON');
    }, 60_000);
  });

  // ---- 2. clashes from both sides; a make-up follows its lesson -------------

  describe('timetable and make-ups', () => {
    let gA: string, gB: string, s1: string;

    beforeAll(async () => {
      gA = await group('A', tch1, 1, '10:00', '11:00');
      gB = await group('B', tch2, 3, '10:00', '11:00');
      s1 = await student('One', [gA]);
    }, 60_000);

    it('a make-up session holds its teacher, room and student against new lessons; a lesson holds them against a make-up', async () => {
      const tue = next(2);
      const c = await credit(s1, gA, 1);
      // A lesson is in the way of a session: the teacher of group A on Monday 10:00.
      const taken = await book(recA, c, { mode: 'SESSION', date: next(1), startTime: '10:30', endTime: '11:30', teacherId: tch1 }).expect(409);
      expect(taken.body.code).toBe('SLOT_TAKEN');
      // The student is in their own lesson then.
      expect((await book(recA, c, { mode: 'SESSION', date: next(1), startTime: '10:30', endTime: '11:30', teacherId: tch3 }).expect(409)).body.code).toBe('STUDENT_BUSY');
      const session = (await book(recA, c, { mode: 'SESSION', date: tue, startTime: '15:00', endTime: '16:00', teacherId: tch3, roomId: room }).expect(201)).body;

      // The other way round: a new weekly lesson on Tuesday afternoon.
      const other = await group('Other', tch2, 4, '08:00', '09:00');
      const types = async (body: Record<string, unknown>) => ((await check(ownerA, body).expect(201)).body.conflicts as Array<{ type: string; makeup?: boolean }>).map((x) => x.type + (x.makeup ? ':makeup' : ''));
      expect(await types({ groupId: other, teacherId: tch3, dayOfWeek: 2, startTime: '15:30', endTime: '16:30' })).toEqual(['MAKEUP']);
      expect(await types({ groupId: other, teacherId: tch2, roomId: room, dayOfWeek: 2, startTime: '15:30', endTime: '16:30' })).toEqual(['MAKEUP']);
      expect(await types({ groupId: other, teacherId: tch2, dayOfWeek: 2, startTime: '16:00', endTime: '17:00' })).toEqual([]);
      // The student's own group moving onto their make-up.
      expect(await types({ groupId: gA, teacherId: tch1, dayOfWeek: 2, startTime: '15:30', endTime: '16:30' })).toEqual(['STUDENT:makeup']);
      // And it is refused when saved, not only when asked.
      const refused = await http().post('/api/schedule').set(bearer(ownerA)).send({ groupId: other, teacherId: tch3, dayOfWeek: 2, startTime: '15:30', endTime: '16:30' }).expect(409);
      expect(refused.body.conflicts.map((x: { type: string }) => x.type)).toEqual(['MAKEUP']);
      await http().post(`/api/makeups/bookings/${session.id}/cancel`).set(bearer(recA)).expect(201);
      // Once the session is cancelled the slot is free again.
      expect(await types({ groupId: other, teacherId: tch3, dayOfWeek: 2, startTime: '15:30', endTime: '16:30' })).toEqual([]);
    }, 60_000);

    it('a make-up follows its lesson to a new time, and is released when the lesson leaves that day', async () => {
      const wed = next(3);
      const c = await credit(s1, gA, 1);
      const b = (await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date: wed }).expect(201)).body;
      expect(b.startTime).toBe('10:00');
      const row = (await rows(gB))[0];

      const later = (await http().patch(`/api/schedule/${row.id}`).set(bearer(ownerA)).send({ startTime: '12:00', endTime: '13:00', roomId: room }).expect(200)).body;
      expect(later.makeups).toEqual({ moved: 1, released: 0 });
      let state = await creditState(c);
      expect(state.status).toBe('BOOKED');
      expect(state.bookings.find((x) => x.id === b.id)).toMatchObject({ status: 'BOOKED', startTime: '12:00', endTime: '13:00', date: wed });

      // Moved to Thursday: there is no lesson on the booked Wednesday any more.
      const moved = (await http().patch(`/api/schedule/${row.id}`).set(bearer(ownerA)).send({ dayOfWeek: 4 }).expect(200)).body;
      expect(moved.makeups).toEqual({ moved: 0, released: 1 });
      state = await creditState(c);
      expect(state.status).toBe('ISSUED');
      expect(state.bookings.find((x) => x.id === b.id)).toMatchObject({ status: 'CANCELLED', note: 'LESSON_CHANGED' });

      // Booked again on the new day, then the lesson is deleted from the timetable.
      const again = (await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date: next(4) }).expect(201)).body;
      const gone = (await http().delete(`/api/schedule/${row.id}`).set(bearer(ownerA)).expect(200)).body;
      expect(gone.makeups).toEqual({ moved: 0, released: 1 });
      state = await creditState(c);
      expect(state.status).toBe('ISSUED');
      expect(state.bookings.find((x) => x.id === again.id)!.status).toBe('CANCELLED');
      // The group form puts the lesson back for the tests below.
      await http().patch(`/api/groups/${gB}`).set(bearer(ownerA)).send({ scheduleDays: DAYS[3], startTime: '10:00', endTime: '11:00' }).expect(200);
      expect((await lessons(gB)).map((l) => l.date)).toEqual([next(3), next(3, 1)].sort());
    }, 60_000);

    it('a booking that would put the student in two places at the new time is released, not moved', async () => {
      const wed = next(3);
      // The student has a make-up session on that Wednesday at 14:00.
      const c1 = await credit(s1, gA, 1);
      const session = (await book(recA, c1, { mode: 'SESSION', date: wed, startTime: '14:00', endTime: '15:00', teacherId: tch3 }).expect(201)).body;
      const c2 = await credit(s1, gA, 1);
      const b = (await book(recA, c2, { mode: 'GROUP_LESSON', targetGroupId: gB, date: wed }).expect(201)).body;
      const row = (await rows(gB))[0];
      // Group B moves onto that hour (past the clash check: the clash is the make-up's, the booking pays for it).
      const res = (await http().patch(`/api/schedule/${row.id}`).set(bearer(ownerA)).send({ startTime: '14:30', endTime: '15:30', allowCollision: true }).expect(200)).body;
      expect(res.makeups).toEqual({ moved: 0, released: 1 });
      expect((await creditState(c2)).status).toBe('ISSUED');
      expect((await creditState(c2)).bookings.find((x) => x.id === b.id)!.status).toBe('CANCELLED');
      // Clean up.
      await http().post(`/api/makeups/bookings/${session.id}/cancel`).set(bearer(recA)).expect(201);
      await http().patch(`/api/schedule/${row.id}`).set(bearer(ownerA)).send({ startTime: '10:00', endTime: '11:00' }).expect(200);
    }, 60_000);

    it('in a group with two lessons a day the make-up is bound to the lesson that was chosen', async () => {
      const g = await group('Twice', tch3, 6, '09:00', '10:00', { maxStudents: 2 });
      await http().post('/api/schedule').set(bearer(ownerA)).send({ groupId: g, teacherId: tch3, dayOfWeek: 6, startTime: '17:00', endTime: '18:00' }).expect(201);
      const filler = await student('Filler', [g]);
      expect(filler).toBeTruthy();
      const sat = next(6);
      const c = await credit(s1, gA, 1);
      const unclear = await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat }).expect(400);
      expect(unclear.body.code).toBe('LESSON_AMBIGUOUS');
      expect(unclear.body.lessons).toEqual([expect.objectContaining({ startTime: '09:00', endTime: '10:00', scheduleId: expect.any(String) }), expect.objectContaining({ startTime: '17:00', endTime: '18:00' })]);
      expect((await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat, startTime: '12:00' }).expect(400)).body.code).toBe('NO_LESSON');
      const evening = (await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat, startTime: '17:00' }).expect(201)).body;
      expect(evening).toMatchObject({ startTime: '17:00', endTime: '18:00' });

      // One free seat per lesson (2 seats, 1 enrolled): the evening one is taken, the morning one is not.
      const s2 = await student('Two', [gA]);
      const c2 = await credit(s2, gA, 1);
      expect((await book(recA, c2, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat, startTime: '17:00' }).expect(409)).body.code).toBe('LESSON_FULL');
      await book(recA, c2, { mode: 'GROUP_LESSON', targetGroupId: g, date: sat, startTime: '09:00' }).expect(201);

      // The morning lesson moves; the evening booking is not dragged along.
      const morning = (await rows(g)).find((r) => r.startTime === '09:00')!;
      const res = (await http().patch(`/api/schedule/${morning.id}`).set(bearer(ownerA)).send({ startTime: '08:00', endTime: '09:00' }).expect(200)).body;
      // The booking is bound to the morning lesson itself, so it goes with it.
      expect(res.makeups).toEqual({ moved: 1, released: 0 });
      expect((await creditState(c)).bookings.find((x) => x.id === evening.id)).toMatchObject({ status: 'BOOKED', startTime: '17:00' });
      expect((await creditState(c2)).bookings.find((x) => x.status === 'BOOKED')).toMatchObject({ startTime: '08:00', endTime: '09:00' });
    }, 60_000);

    // ---- races ---------------------------------------------------------------

    it('a lesson called off and a make-up booked into it at the same moment: never a live booking in a cancelled lesson', async () => {
      for (let round = 0; round < 3; round++) {
        const date = next(3, round + 1);
        const c = await credit(s1, gA, 1);
        const [cancel, booking] = await Promise.all([
          http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: gB, date }),
          book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date }),
        ]);
        expect(cancel.status).toBe(201);
        expect([201, 400]).toContain(booking.status);
        if (booking.status === 400) expect(booking.body.code).toBe('NO_LESSON');
        // Booked first: the cancellation released it. Cancelled first: it was never made.
        const state = await creditState(c);
        expect(state.status).toBe('ISSUED');
        expect(state.bookings.filter((x) => x.status === 'BOOKED')).toEqual([]);
        if (booking.status === 201) expect(cancel.body.releasedBookings).toBe(1);
      }
    }, 90_000);

    it('two groups that share a student get a lesson at the same hour at once: one is refused', async () => {
      const gX = await group('X', tch1, 7, '06:00', '06:45');
      const gY = await group('Y', tch2, 7, '07:00', '07:45');
      await student('Shared', [gX, gY]);
      const create = (g: string, teacherId: string) => http().post('/api/schedule').set(bearer(ownerA)).send({ groupId: g, teacherId, dayOfWeek: 5, startTime: '18:00', endTime: '19:00' });
      const res = await Promise.all([create(gX, tch1), create(gY, tch2)]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(res.find((r) => r.status === 409)!.body.conflicts.map((x: { type: string }) => x.type)).toEqual(['STUDENT']);
    }, 60_000);

    it('the last free seat booked from two accounts at once: one gets it', async () => {
      const small = await group('Small', tch3, 5, '09:00', '10:00', { maxStudents: 1 });
      const s2 = await student('Three', [gA]);
      const [ca, cb] = [await credit(s1, gA, 1), await credit(s2, gA, 1)];
      const fri = next(5);
      const res = await Promise.all([book(recA, ca, { mode: 'GROUP_LESSON', targetGroupId: small, date: fri }), book(managerA, cb, { mode: 'GROUP_LESSON', targetGroupId: small, date: fri })]);
      expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(res.find((r) => r.status === 409)!.body.code).toBe('LESSON_FULL');
    }, 60_000);

    it('one credit, several requests: used once, cancelled once, marked once, returned once', async () => {
      const c = await credit(s1, gA, 1);
      // Booked from two accounts into three lessons at once.
      const tries = await Promise.all([
        book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date: next(3, 4) }),
        book(managerA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date: next(3, 5) }),
        book(ownerA, c, { mode: 'SESSION', date: next(2, 4), startTime: '13:00', endTime: '14:00', teacherId: tch3 }),
      ]);
      expect(tries.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const bookingId = tries.find((r) => r.status === 201)!.body.id as string;

      // The booking cancelled three times at once: the credit comes back once.
      const cancels = await Promise.all([0, 1, 2].map(() => http().post(`/api/makeups/bookings/${bookingId}/cancel`).set(bearer(recA))));
      expect(cancels.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect((await creditState(c)).status).toBe('ISSUED');

      // Booked again, then the lesson is called off three times at once.
      const date = next(3, 6);
      await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date }).expect(201);
      const offs = await Promise.all([0, 1, 2].map(() => http().post('/api/lessons/cancellations').set(bearer(managerA)).send({ groupId: gB, date })));
      expect(offs.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect(offs.find((r) => r.status === 201)!.body.releasedBookings).toBe(1);
      expect((await creditState(c)).status).toBe('ISSUED');

      // Booked once more and marked from three requests: one mark, the credit is used.
      const b = (await book(recA, c, { mode: 'GROUP_LESSON', targetGroupId: gB, date: next(3, 7) }).expect(201)).body;
      const marks = await Promise.all(['ATTENDED', 'MISSED', 'ATTENDED'].map((status) => http().post(`/api/makeups/bookings/${b.id}/attendance`).set(bearer(ownerA)).send({ status })));
      expect(marks.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const final = await creditState(c);
      expect(['USED', 'FORFEITED']).toContain(final.status);
      expect(final.bookings.filter((x) => x.status === 'ATTENDED' || x.status === 'MISSED')).toHaveLength(1);
      // A closed booking cannot be cancelled back into a usable credit.
      await http().post(`/api/makeups/bookings/${b.id}/cancel`).set(bearer(recA)).expect(409);
      expect((await creditState(c)).status).toBe(final.status);
    }, 90_000);
  });

  // ---- 3. what a question about clashes may tell ----------------------------

  describe('POST /api/schedule/check-conflict', () => {
    let mine: string, theirs: string;
    const NAME = 'LI Zebo Yashirin';
    const ask = { teacherId: undefined as string | undefined, dayOfWeek: 2, startTime: '11:00', endTime: '12:00' };

    beforeAll(async () => {
      mine = await group('Mine', tch1, 4, '11:00', '12:00');
      theirs = await group('Theirs', tch2, 2, '11:00', '12:00');
      await http().post('/api/students').set(bearer(ownerA)).send({ fullName: NAME, phone: `+99897${String(suffix).slice(-7)}`, groupIds: [mine, theirs] }).expect(201);
    }, 60_000);

    it('needs a sign-in, and a group of the asking center', async () => {
      await http().post('/api/schedule/check-conflict').send({ groupId: mine, ...ask }).expect(401);
      // Another center's group, and an id that does not exist, are the same "not found".
      const foreign = await check(ownerB, { groupId: mine, ...ask }).expect(404);
      const missing = await check(ownerB, { groupId: 'no-such-group', ...ask }).expect(404);
      expect(foreign.body.message).toBe(missing.body.message);
      expect(JSON.stringify(foreign.body)).not.toContain(NAME);
      await check(ownerA, { groupId: groupOfB, ...ask }).expect(404);
    });

    it('a teacher asks about their own groups only', async () => {
      const refused = await check(t2, { groupId: mine, ...ask }).expect(403);
      expect(JSON.stringify(refused.body)).not.toContain(NAME);
      // Their own group: they plan its lessons and know its students.
      const own = (await check(t1, { groupId: mine, ...ask }).expect(201)).body;
      expect(own.conflicts).toHaveLength(1);
      expect(own.conflicts[0]).toMatchObject({ type: 'STUDENT', studentCount: 1, studentNames: [NAME] });
      expect(own.conflicts[0].message).toContain(NAME);
    });

    it('someone who only sees the timetable gets the count, never a name - in the list and in the text', async () => {
      for (const viewer of [recA, managerA]) {
        const body = (await check(viewer, { groupId: mine, ...ask }).expect(201)).body;
        expect(body.hasConflict).toBe(true);
        expect(body.conflicts[0]).toMatchObject({ type: 'STUDENT', studentCount: 1 });
        expect(body.conflicts[0].studentNames).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain(NAME);
        expect(body.conflicts[0].message).toContain("1 nafar o'quvchi");
      }
      // The owner plans the timetable and sees the students.
      const full = (await check(ownerA, { groupId: mine, ...ask }).expect(201)).body;
      expect(full.conflicts[0].studentNames).toEqual([NAME]);
    });

    it('the refusal of a save follows the same rule as the question', async () => {
      // The teacher of the group (may plan it, may see its students): named.
      const byTeacher = await http().post('/api/schedule').set(bearer(t1)).send({ groupId: mine, ...ask }).expect(409);
      expect(byTeacher.body.conflicts[0].studentNames).toEqual([NAME]);
      // A teacher of another group cannot even try: no clash list, no name.
      const byOther = await http().post('/api/schedule').set(bearer(t2)).send({ groupId: mine, ...ask }).expect(403);
      expect(JSON.stringify(byOther.body)).not.toContain(NAME);
      const row = (await rows(mine))[0];
      const moved = await http().patch(`/api/schedule/${row.id}`).set(bearer(t2)).send({ dayOfWeek: 2 }).expect(403);
      expect(JSON.stringify(moved.body)).not.toContain(NAME);
      const ownMove = await http().patch(`/api/schedule/${row.id}`).set(bearer(t1)).send({ dayOfWeek: 2 }).expect(409);
      expect(ownMove.body.conflicts[0].message).toContain(NAME);
    });
  });
});
