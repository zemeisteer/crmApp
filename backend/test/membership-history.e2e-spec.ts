import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { CalendarEventsService } from '../src/calendar/calendar-events.service.js';
import { DB, Database } from '../src/db/db.module.js';
import { enrollmentPeriods, enrollments, lessonCancellations, schedules, students } from '../src/db/schema.js';

// Every stay of a student in a group is kept: joining, leaving, a break and
// coming back, a pause, a move to another group. A lesson in a break is not
// the student's - for attendance, credits and the calendar alike.
describe('Membership history: stays in a group (e2e)', () => {
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
  /** An instant given as a center-local (Tashkent, UTC+5) date and time. */
  const local = (date: string, hhmm = '00:00', addDays = 0) => new Date(new Date(`${date}T${hhmm}:00Z`).getTime() - 5 * 3_600_000 + addDays * 86_400_000);

  let owner: string, tenantId: string;
  let seq = 0;
  const group = async (name: string, day: number, start: string, end: string, extra: Record<string, unknown> = {}) => (await http().post('/api/groups').set(bearer(owner))
    .send({ name: `MH ${name}`, subject: 'English', scheduleDays: DAYS[day], startTime: start, endTime: end, maxStudents: 30, ...extra }).expect(201)).body.id as string;
  const student = async (name: string, groupIds: string[]) => (await http().post('/api/students').set(bearer(owner))
    .send({ fullName: `MH ${name}`, phone: `+9985${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;
  const stays = (studentId: string, groupId?: string) => db.select().from(enrollmentPeriods)
    .where(and(eq(enrollmentPeriods.studentId, studentId), groupId ? eq(enrollmentPeriods.groupId, groupId) : undefined)).orderBy(asc(enrollmentPeriods.startedAt));
  const history = async (studentId: string) => (await http().get(`/api/students/${studentId}/memberships`).set(bearer(owner)).expect(200)).body as Array<{ groupId: string; startedAt: string; endedAt: string | null; endReason: string | null; source: string }>;
  const mark = (groupId: string, studentId: string, date: string, status = 'ABSENT', scheduleId?: string) =>
    http().post('/api/attendance').set(bearer(owner)).send({ groupId, date, scheduleId, entries: [{ studentId, status }] });
  const issue = (body: Record<string, unknown>) => http().post('/api/makeups/credits').set(bearer(owner)).send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `MH ${suffix}`, subdomain: `mh-${suffix}`, email: `mh-${suffix}@test.uz`, password: 'password123', fullName: 'Owner MH' }).expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.tenant.id;
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('in the group, out, a break, back again: two stays; a lesson in the break is not the student\'s - attendance, credits, calendar', async () => {
    const g = await group('main', 1, '10:00', '11:00');
    const row = (await db.select().from(schedules).where(eq(schedules.groupId, g)))[0];
    const s = await student('returning', [g]);
    expect(await stays(s, g)).toEqual([expect.objectContaining({ endedAt: null, source: 'RECORDED' })]);

    await http().delete(`/api/students/${s}/enroll/${g}`).set(bearer(owner)).expect(200);
    expect(await stays(s, g)).toEqual([expect.objectContaining({ endReason: 'LEFT_GROUP' })]);
    expect((await stays(s, g))[0].endedAt).not.toBeNull();
    await http().post(`/api/students/${s}/enroll/${g}`).set(bearer(owner)).expect(201);
    const two = await stays(s, g);
    expect(two).toHaveLength(2);
    expect(two.map((p) => p.endedAt === null)).toEqual([false, true]);
    // One enrollment row as before (the current state); the history is the two stays.
    expect(await db.select().from(enrollments).where(and(eq(enrollments.studentId, s), eq(enrollments.groupId, g)))).toHaveLength(1);

    // Put the two stays where the lessons are: Mondays 4 and 3 weeks ago, a break of two Mondays, back for the last one.
    const [m4, m3, m2, m1, m0] = [last(1, 4), last(1, 3), last(1, 2), last(1, 1), last(1, 0)];
    await db.update(enrollmentPeriods).set({ startedAt: local(m4, '00:00', -3), endedAt: local(m3, '00:00', 3) }).where(eq(enrollmentPeriods.id, two[0].id));
    await db.update(enrollmentPeriods).set({ startedAt: local(m0, '00:00', -2) }).where(eq(enrollmentPeriods.id, two[1].id));
    const h = await history(s);
    expect(h.map((p) => [p.groupId, p.endedAt === null, p.source])).toEqual([[g, true, 'RECORDED'], [g, false, 'RECORDED']]);

    // Attendance: the lessons of the two stays can be marked, the ones in the break cannot.
    await mark(g, s, m4).expect(201);
    await mark(g, s, m0).expect(201);
    expect((await mark(g, s, m2).expect(400)).body.code).toBe('NOT_A_MEMBER');
    expect((await mark(g, s, m1).expect(400)).body.code).toBe('NOT_A_MEMBER');

    // Credits: a lesson called off during a stay counts, one called off during the break does not.
    await db.insert(lessonCancellations).values([{ tenantId, groupId: g, date: m3, scheduleId: row.id }, { tenantId, groupId: g, date: m1, scheduleId: row.id }]);
    const list = (await http().get(`/api/makeups/eligible?from=${m4}&to=${m0}`).set(bearer(owner)).expect(200)).body as Array<{ studentId: string; date: string; reason: string }>;
    expect(list.filter((r) => r.studentId === s).map((r) => [r.date, r.reason]).sort()).toEqual([[m4, 'ABSENT'], [m3, 'LESSON_CANCELLED'], [m0, 'ABSENT']].sort());
    await issue({ studentId: s, groupId: g, date: m3, reason: 'LESSON_CANCELLED' }).expect(201);
    expect((await issue({ studentId: s, groupId: g, date: m1, reason: 'LESSON_CANCELLED' }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
    // An absence written into the break by some other way earns nothing either.
    await db.execute(sql`insert into attendance (id, tenant_id, group_id, student_id, date, status, schedule_id, start_time) values (${`mh-${suffix}`}, ${tenantId}, ${g}, ${s}, ${m2}, 'ABSENT', ${row.id}, '10:00')`);
    expect((await issue({ studentId: s, groupId: g, date: m2, reason: 'ABSENT' }).expect(400)).body.code).toBe('NOT_ELIGIBLE');
    expect(((await http().get(`/api/makeups/eligible?from=${m2}&to=${m2}`).set(bearer(owner)).expect(200)).body as Array<{ studentId: string }>).filter((r) => r.studentId === s)).toEqual([]);

    // The student's calendar: the Mondays of the two stays (and the coming ones), none of the break.
    const events = await app.get(CalendarEventsService).events({ tenantId, scope: 'STUDENT', studentId: s }, m4, next(1));
    const dates = events.filter((e) => e.uid.startsWith('les-')).map((e) => e.date).sort();
    // (today too, when today is a Monday)
    const mondays: string[] = [];
    for (let d = new Date(`${m4}T00:00:00Z`); dateOf(d) <= next(1); d = new Date(d.getTime() + 7 * 86_400_000)) mondays.push(dateOf(d));
    expect(dates).toEqual(mondays.filter((d) => d !== m2 && d !== m1));
    expect(dates).toContain(m0);
    expect(dates).not.toContain(m2);
  });

  it('boundaries inside one day: the start belongs to the stay, the end does not', async () => {
    // Saturday 09:00 and 15:00; the stay begins at 10:00 one Saturday and ends at 12:00 the next.
    const g = await group('twice', 6, '09:00', '10:00');
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, dayOfWeek: 6, startTime: '15:00', endTime: '16:00' }).expect(201);
    const rows = await db.select().from(schedules).where(eq(schedules.groupId, g));
    const am = rows.find((r) => r.startTime === '09:00')!.id;
    const pm = rows.find((r) => r.startTime === '15:00')!.id;
    const s = await student('same-day', [g]);
    const [first, second] = [last(6, 1), last(6, 0)];
    await db.update(enrollmentPeriods).set({ startedAt: local(first, '10:00'), endedAt: local(second, '12:00'), endReason: 'LEFT_GROUP' }).where(eq(enrollmentPeriods.studentId, s));
    await db.insert(lessonCancellations).values([first, second].flatMap((date) => [am, pm].map((scheduleId) => ({ tenantId, groupId: g, date, scheduleId }))));
    const can = async (date: string, scheduleId: string) => {
      const r = await issue({ studentId: s, groupId: g, date, reason: 'LESSON_CANCELLED', scheduleId });
      return r.status === 201 ? true : r.body.code;
    };
    expect(await can(first, am)).toBe('NOT_ELIGIBLE'); // 09:00, an hour before joining
    expect(await can(first, pm)).toBe(true);
    expect(await can(second, am)).toBe(true);
    expect(await can(second, pm)).toBe('NOT_ELIGIBLE'); // 15:00, three hours after leaving
    // The same for marking attendance - except that before the first known stay a mark is still taken.
    await mark(g, s, last(6, 2), 'PRESENT', am).expect(201); // before the student was entered at all: lenient
    expect((await mark(g, s, second, 'PRESENT', pm).expect(409)).body.code).toBe('LESSON_CANCELLED');
    await db.delete(lessonCancellations).where(and(eq(lessonCancellations.groupId, g), eq(lessonCancellations.date, second), eq(lessonCancellations.scheduleId, pm)));
    expect((await mark(g, s, second, 'PRESENT', pm).expect(400)).body.code).toBe('NOT_A_MEMBER');
  });

  it('a pause ends the stays and keeps the seat; coming back begins new ones; a move is one stay ended and another begun', async () => {
    // A lesson late today: after the pause below, before midnight.
    const a = await group('pause a', dow(tashkent(0)), '23:40', '23:55', { maxStudents: 1 });
    const b = await group('pause b', 3, '10:00', '11:00');
    const s = await student('pausing', [a, b]);
    await http().patch(`/api/students/${s}`).set(bearer(owner)).send({ status: 'PAUSED' }).expect(200);
    expect((await stays(s)).map((p) => [p.endReason, p.endedAt === null])).toEqual([['PAUSED', false], ['PAUSED', false]]);
    // Still enrolled, and the seat is still taken.
    expect((await db.select().from(enrollments).where(eq(enrollments.studentId, s))).map((e) => e.status)).toEqual(['ACTIVE', 'ACTIVE']);
    const other = await student('wants the seat', []);
    expect((await http().post(`/api/students/${other}/enroll/${a}`).set(bearer(owner)).expect(409)).body.code).toBe('GROUP_FULL');
    // Not attending: today's lesson is not marked for them.
    const today = dateOf(tashkent(0));
    expect((await mark(a, s, today, 'PRESENT').expect(400)).body.code).toBe('NOT_A_MEMBER');

    await http().patch(`/api/students/${s}`).set(bearer(owner)).send({ status: 'ACTIVE' }).expect(200);
    const after = await stays(s);
    expect(after).toHaveLength(4);
    expect(after.filter((p) => p.endedAt === null).map((p) => p.groupId).sort()).toEqual([a, b].sort());
    await mark(a, s, today, 'PRESENT').expect(201);
    // Saving the profile again without a status change opens and closes nothing.
    await http().patch(`/api/students/${s}`).set(bearer(owner)).send({ status: 'ACTIVE', notes: 'x' }).expect(200);
    expect(await stays(s)).toHaveLength(4);

    // A move from b to another group.
    const c = await group('pause c', 4, '10:00', '11:00');
    await http().delete(`/api/students/${s}/enroll/${b}`).set(bearer(owner)).expect(200);
    await http().post(`/api/students/${s}/enroll/${c}`).set(bearer(owner)).expect(201);
    const open = (await stays(s)).filter((p) => p.endedAt === null).map((p) => p.groupId).sort();
    expect(open).toEqual([a, c].sort());
    expect((await stays(s, b)).map((p) => p.endReason)).toEqual(['PAUSED', 'LEFT_GROUP']);
    // Removed and restored: the time in the trash is not a stay.
    await http().delete(`/api/students/${s}`).set(bearer(owner)).expect(200);
    expect((await stays(s)).filter((p) => p.endedAt === null)).toEqual([]);
    await http().post(`/api/students/${s}/restore`).set(bearer(owner)).expect(201);
    expect((await stays(s)).filter((p) => p.endedAt === null).map((p) => p.groupId).sort()).toEqual([a, c].sort());
  });

  it('two enrolments of one student into one group at once: one stay, never two open', async () => {
    const g = await group('race', 5, '10:00', '11:00');
    for (let round = 0; round < 3; round++) {
      const s = await student(`race ${round}`, []);
      const res = await Promise.all([0, 1, 2].map(() => http().post(`/api/students/${s}/enroll/${g}`).set(bearer(owner))));
      expect(res.map((r) => r.status).sort()).toEqual([201, 400, 400]);
      expect(await db.select().from(enrollmentPeriods).where(and(eq(enrollmentPeriods.studentId, s), eq(enrollmentPeriods.groupId, g), isNull(enrollmentPeriods.endedAt)))).toHaveLength(1);
      // Leave and come back three times: stays never overlap.
      for (let i = 0; i < 3; i++) {
        await http().delete(`/api/students/${s}/enroll/${g}`).set(bearer(owner)).expect(200);
        await http().post(`/api/students/${s}/enroll/${g}`).set(bearer(owner)).expect(201);
      }
      const all = await stays(s, g);
      expect(all).toHaveLength(4);
      for (let i = 1; i < all.length; i++) expect(all[i].startedAt.getTime()).toBeGreaterThanOrEqual(all[i - 1].endedAt!.getTime());
    }
  });

  it('migration: what the old rows know becomes LEGACY stays - and nothing is made up', async () => {
    const g = await group('migrate', 7, '10:00', '11:00');
    const ids = [] as string[];
    for (const n of ['active', 'ended', 'ended-unknown', 'paused', 'has-history']) ids.push(await student(`mig ${n}`, [g]));
    const [active, ended, unknown, paused, kept] = ids;
    const joined = new Date(Date.now() - 40 * 86_400_000);
    const left = new Date(Date.now() - 10 * 86_400_000);
    // As before the migration: only the enrollment rows, in the states the old code left them.
    await db.delete(enrollmentPeriods).where(and(eq(enrollmentPeriods.groupId, g), sql`${enrollmentPeriods.studentId} <> ${kept}`));
    await db.update(enrollments).set({ joinedAt: joined }).where(eq(enrollments.groupId, g));
    await db.update(enrollments).set({ status: 'CANCELLED', leftAt: left }).where(and(eq(enrollments.groupId, g), eq(enrollments.studentId, ended)));
    await db.update(enrollments).set({ status: 'CANCELLED', leftAt: null }).where(and(eq(enrollments.groupId, g), eq(enrollments.studentId, unknown)));
    await db.update(students).set({ status: 'PAUSED', pausedAt: left }).where(eq(students.id, paused));
    const statements = readFileSync(join(__dirname, '..', 'drizzle', '0054_enrollment_periods.sql'), 'utf8').split('--> statement-breakpoint');
    const backfill = statements[statements.length - 1];
    expect(backfill).toContain('INSERT INTO "enrollment_periods"');
    await db.execute(sql.raw(backfill));
    await db.execute(sql.raw(backfill)); // again: nothing more
    const of = async (id: string) => (await stays(id, g)).map((p) => ({ source: p.source, from: p.startedAt.getTime(), until: p.endedAt?.getTime() ?? null, why: p.endReason }));
    expect(await of(active)).toEqual([{ source: 'LEGACY', from: joined.getTime(), until: null, why: null }]);
    expect(await of(ended)).toEqual([{ source: 'LEGACY', from: joined.getTime(), until: left.getTime(), why: 'LEFT_GROUP' }]);
    expect(await of(unknown)).toEqual([]); // when it ended is not known: no interval is invented
    expect(await of(paused)).toEqual([{ source: 'LEGACY', from: joined.getTime(), until: left.getTime(), why: 'PAUSED' }]);
    expect((await of(kept)).map((p) => p.source)).toEqual(['RECORDED']); // had its history already
  });

  it('the list for a past lesson is who was in the group then: someone who left since is on it, a break is not', async () => {
    const g = await group('roster', 2, '10:00', '11:00');
    const row = (await db.select().from(schedules).where(eq(schedules.groupId, g)))[0];
    const stayed = await student('roster stayed', [g]);
    const left = await student('roster left', [g]);
    const returned = await student('roster returned', [g]);
    await http().delete(`/api/students/${left}/enroll/${g}`).set(bearer(owner)).expect(200);
    await http().delete(`/api/students/${returned}/enroll/${g}`).set(bearer(owner)).expect(200);
    await http().post(`/api/students/${returned}/enroll/${g}`).set(bearer(owner)).expect(201);
    const [t3, t2, t1] = [last(2, 2), last(2, 1), last(2, 0)];
    const set = async (studentId: string, index: number, v: { startedAt?: Date; endedAt?: Date }) => {
      const list = await stays(studentId, g);
      await db.update(enrollmentPeriods).set(v).where(eq(enrollmentPeriods.id, list[index].id));
    };
    // Everyone joined before the oldest Tuesday; "left" went after the middle one; "returned" was away for the middle one.
    await set(stayed, 0, { startedAt: local(t3, '00:00', -2) });
    await set(left, 0, { startedAt: local(t3, '00:00', -2), endedAt: local(t2, '00:00', 2) });
    await set(returned, 0, { startedAt: local(t3, '00:00', -2), endedAt: local(t3, '00:00', 2) });
    await set(returned, 1, { startedAt: local(t1, '00:00', -2) });
    const roster = async (date: string, token = owner) => (await http().get(`/api/groups/${g}/roster?date=${date}&scheduleId=${row.id}`).set(bearer(token)).expect(200)).body as Array<{ studentId: string; current: boolean }>;
    const names = (list: Array<{ studentId: string; current: boolean }>) => list.map((r) => [r.studentId === stayed ? 'stayed' : r.studentId === left ? 'left' : 'returned', r.current]).sort();
    expect(names(await roster(t3))).toEqual([['left', false], ['returned', true], ['stayed', true]]);
    expect(names(await roster(t2))).toEqual([['left', false], ['stayed', true]]); // "returned" was on a break
    expect(names(await roster(t1))).toEqual([['returned', true], ['stayed', true]]); // "left" had gone
    expect(names(await roster(next(2)))).toEqual([['returned', true], ['stayed', true]]);
    // The list and the save agree: who is on it can be marked, who is not cannot.
    await mark(g, left, t2, 'ABSENT', row.id).expect(201);
    expect((await mark(g, returned, t2, 'PRESENT', row.id).expect(400)).body.code).toBe('NOT_A_MEMBER');
    expect((await mark(g, left, t1, 'PRESENT', row.id).expect(400)).body.code).toBe('NOT_A_MEMBER');
    await http().get(`/api/groups/${g}/roster?date=not-a-date`).set(bearer(owner)).expect(400);
    await http().get(`/api/groups/no-such-group/roster?date=${t1}`).set(bearer(owner)).expect(404);
  });
});
