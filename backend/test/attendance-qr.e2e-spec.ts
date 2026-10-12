import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { attendance, students, tenants } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';

// A scanned student card is a mark like any other: the same lesson, center,
// permission and membership checks; never a guess about which lesson; one
// row and one "arrived" event however many scans arrive at once; and the
// debt it shows is the month's debt, not "has ever paid".
// (Replaces the mocked unit tests of qrCheckIn: these run on PostgreSQL.
// Telegram and webhooks are observed at the service boundary - nothing is sent.)
describe('QR attendance (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
  const today = () => dateOf(tashkent(0));
  const todayName = () => DAYS[dow(tashkent(0))];
  const otherDayName = () => DAYS[dow(tashkent(3))];
  const hourNow = () => tashkent(0).getUTCHours();

  let owner: string, ownerB: string, tenantId: string;
  type Spy = { mock: { calls: unknown[][] } };
  let telegram: Spy, webhook: Spy;
  let seq = 0;
  const group = async (name: string, body: Record<string, unknown>, token = owner) => (await http().post('/api/groups').set(bearer(token))
    .send({ name: `QR ${name}`, subject: 'English', maxStudents: 30, ...body }).expect(201)).body.id as string;
  /** One lesson covering the whole day: on now, whenever the test runs. */
  const allDay = { scheduleDays: '', startTime: '00:05', endTime: '23:55' };
  const student = async (name: string, groupIds: string[], token = owner) => (await http().post('/api/students').set(bearer(token))
    .send({ fullName: `QR ${name}`, phone: `+9984${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;
  const scan = (token: string, studentId: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/attendance/qr-checkin').set(bearer(token)).send({ code: `TALIMCRM:STUDENT:${studentId}`, ...extra });
  const marksOf = (studentId: string) => db.select().from(attendance).where(eq(attendance.studentId, studentId));
  const events = (studentId: string) => ({
    webhooks: webhook.mock.calls.filter((c) => c[1] === 'attendance.marked' && (c[2] as { studentId?: string }).studentId === studentId).length,
    telegrams: telegram.mock.calls.filter((c) => c[0] === `chat-${studentId}`).length,
  });
  const linkTelegram = (studentId: string) => db.update(students).set({ telegramChatId: `chat-${studentId}` }).where(eq(students.id, studentId));
  const rowsOf = async (g: string) => (await http().get(`/api/schedule?groupId=${g}`).set(bearer(owner)).expect(200)).body as Array<{ id: string; startTime: string }>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    telegram = vi.spyOn(app.get(TelegramService), 'sendMessage').mockResolvedValue(1) as unknown as Spy;
    webhook = vi.spyOn(app.get(WebhooksService), 'dispatch').mockResolvedValue(undefined as never) as unknown as Spy;
    const register = async (key: string) => (await http().post('/api/auth/register')
      .send({ centerName: `QR ${key} ${suffix}`, subdomain: `qr-${key}-${suffix}`, email: `qr-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    const a = await register('a');
    owner = a.accessToken;
    tenantId = a.tenant.id;
    ownerB = (await register('b')).accessToken;
    allDay.scheduleDays = todayName();
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('a scan marks the student present in the lesson that is on, and says so once', async () => {
    const g = await group('basic', allDay);
    const [row] = await rowsOf(g);
    const s = await student('basic', [g]);
    await linkTelegram(s);
    const res = (await scan(owner, s).expect(201)).body;
    expect(res).toMatchObject({ success: true, alreadyMarked: false, student: { id: s, telegramLinked: true }, group: { id: g }, attendance: { date: today(), status: 'PRESENT', scheduleId: row.id, startTime: '00:05' } });
    expect(await marksOf(s)).toEqual([expect.objectContaining({ groupId: g, date: today(), status: 'PRESENT', scheduleId: row.id, startTime: '00:05' })]);
    expect(events(s)).toEqual({ webhooks: 1, telegrams: 1 });
    expect(webhook.mock.calls.find((c) => (c[2] as { studentId?: string }).studentId === s)![2]).toMatchObject({ groupId: g, via: 'QR_SCANNER', scheduleId: row.id });

    // Scanned again: already marked - no second row, no second message.
    const again = (await scan(owner, s).expect(201)).body;
    expect(again).toMatchObject({ alreadyMarked: true, attendance: { status: 'PRESENT', scheduleId: row.id } });
    expect(await marksOf(s)).toHaveLength(1);
    expect(events(s)).toEqual({ webhooks: 1, telegrams: 1 });
    // Marked absent by the teacher meanwhile: a scan does not overwrite it, and reports what is recorded.
    await http().post('/api/attendance').set(bearer(owner)).send({ groupId: g, date: today(), scheduleId: row.id, entries: [{ studentId: s, status: 'ABSENT' }] }).expect(201);
    expect((await scan(owner, s).expect(201)).body).toMatchObject({ alreadyMarked: true, attendance: { status: 'ABSENT' } });
  });

  it('six scans at the same moment: one row, one event, one of them is the first', async () => {
    const g = await group('parallel', allDay);
    const s = await student('parallel', [g]);
    await linkTelegram(s);
    const res = await Promise.all([0, 1, 2, 3, 4, 5].map(() => scan(owner, s)));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    expect(res.filter((r) => r.body.alreadyMarked === false)).toHaveLength(1);
    expect(await marksOf(s)).toHaveLength(1);
    // (the events are sent after the response is built: give them a moment)
    await new Promise((r) => setTimeout(r, 200));
    expect(events(s)).toEqual({ webhooks: 1, telegrams: 1 });
  });

  it('nobody outside the center, no unknown card, and no student who is not attending', async () => {
    const g = await group('status', allDay);
    const s = await student('status', [g]);
    await scan(ownerB, s).expect(404); // another center's scanner
    await scan(owner, 'no-such-student').expect(404);
    const loose = await student('no group', []);
    expect((await scan(owner, loose).expect(400)).body.code).toBe('NOT_ENROLLED');

    for (const status of ['PAUSED', 'LEFT', 'GRADUATED']) {
      await http().patch(`/api/students/${s}`).set(bearer(owner)).send({ status }).expect(200);
      const res = await scan(owner, s).expect(409);
      expect(res.body).toMatchObject({ code: 'STUDENT_NOT_ATTENDING', status });
      await http().patch(`/api/students/${s}`).set(bearer(owner)).send({ status: 'ACTIVE' }).expect(200);
    }
    await http().delete(`/api/students/${s}`).set(bearer(owner)).expect(200);
    await scan(owner, s).expect(404);
    expect(await marksOf(s)).toEqual([]);
    // Back, active and in the group again: it works.
    await http().post(`/api/students/${s}/restore`).set(bearer(owner)).expect(201);
    await scan(owner, s).expect(201);
    // Out of the group: enrolled nowhere.
    const out = await student('unenrolled', [g]);
    await http().delete(`/api/students/${out}/enroll/${g}`).set(bearer(owner)).expect(200);
    expect((await scan(owner, out).expect(400)).body.code).toBe('NOT_ENROLLED');
    expect(await marksOf(out)).toEqual([]);
  });

  it('a named group that is not the student\'s is an error - never another group instead', async () => {
    const mine = await group('mine', allDay);
    const other = await group('not mine', allDay);
    const foreign = await group('foreign', allDay, ownerB);
    const s = await student('named', [mine]);
    for (const groupId of [other, foreign, 'no-such-group']) {
      expect((await scan(owner, s, { groupId }).expect(400)).body.code).toBe('NOT_IN_GROUP');
    }
    expect(await marksOf(s)).toEqual([]);
    expect((await scan(owner, s, { groupId: mine }).expect(201)).body.group.id).toBe(mine);
  });

  it('a lesson called off, a day without a lesson and a group without a timetable are three different answers', async () => {
    // Called off: refused, and not turned into a mark for the day.
    const off = await group('called off', allDay);
    const [row] = await rowsOf(off);
    const s1 = await student('called off', [off]);
    await http().post('/api/lessons/cancellations').set(bearer(owner)).send({ groupId: off, date: today(), scheduleId: row.id }).expect(201);
    expect((await scan(owner, s1).expect(409)).body.code).toBe('LESSON_CANCELLED');
    expect(await marksOf(s1)).toEqual([]);

    // A timetable, and no lesson today.
    const none = await group('other day', { scheduleDays: otherDayName(), startTime: '10:00', endTime: '11:00' });
    const s2 = await student('other day', [none]);
    expect((await scan(owner, s2).expect(409)).body.code).toBe('NO_LESSON_TODAY');
    expect(await marksOf(s2)).toEqual([]);

    // No timetable at all: attendance is kept per day there.
    const loose = await group('no timetable', {});
    const s3 = await student('no timetable', [loose]);
    expect((await scan(owner, s3).expect(201)).body.attendance).toMatchObject({ scheduleId: null, startTime: null, status: 'PRESENT' });
    expect(await marksOf(s3)).toEqual([expect.objectContaining({ scheduleId: null, date: today() })]);
  });

  it('two lessons in one day: the one that is on; when neither is, the scanner has to say - no guess', async () => {
    // Morning and afternoon halves of the day: one of them is on now.
    const g = await group('halves', { scheduleDays: todayName(), startTime: '00:05', endTime: '11:55' });
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: g, dayOfWeek: dow(tashkent(0)), startTime: '12:30', endTime: '23:55' }).expect(201);
    const rows = await rowsOf(g);
    const s = await student('halves', [g]);
    const minutesNow = hourNow() * 60 + tashkent(0).getUTCMinutes();
    // (11:55-12:00 belongs to neither or both: outside it exactly one lesson is on)
    if (minutesNow < 11 * 60 + 50 || minutesNow > 12 * 60 + 5) {
      const expected = rows.find((r) => (minutesNow < 12 * 60 ? r.startTime === '00:05' : r.startTime === '12:30'))!.id;
      expect((await scan(owner, s).expect(201)).body.attendance.scheduleId).toBe(expected);
      expect(await marksOf(s)).toHaveLength(1);
    }

    // Two short lessons, neither on now.
    const [a, b] = hourNow() < 12 ? [['14:00', '15:00'], ['16:00', '17:00']] : [['01:00', '02:00'], ['03:00', '04:00']];
    const far = await group('far', { scheduleDays: todayName(), startTime: a[0], endTime: a[1] });
    await http().post('/api/schedule').set(bearer(owner)).send({ groupId: far, dayOfWeek: dow(tashkent(0)), startTime: b[0], endTime: b[1] }).expect(201);
    const farRows = await rowsOf(far);
    const s2 = await student('far', [far]);
    const unclear = await scan(owner, s2).expect(400);
    expect(unclear.body.code).toBe('LESSON_AMBIGUOUS');
    expect(unclear.body.lessons.map((l: { scheduleId: string }) => l.scheduleId).sort()).toEqual(farRows.map((r) => r.id).sort());
    expect(await marksOf(s2)).toEqual([]);
    const second = farRows.find((r) => r.startTime === b[0])!.id;
    expect((await scan(owner, s2, { scheduleId: second }).expect(201)).body.attendance.scheduleId).toBe(second);
    expect((await scan(owner, s2, { scheduleId: 'not-a-lesson' }).expect(409)).body.code).toBe('NO_LESSON_TODAY');
    // One lesson only, long over: still that lesson - there is nothing to confuse it with.
    const over = await group('over', { scheduleDays: todayName(), startTime: a[0], endTime: a[1] });
    const s3 = await student('over', [over]);
    expect((await scan(owner, s3).expect(201)).body.attendance.scheduleId).toBe((await rowsOf(over))[0].id);
  });

  it('a student in two groups: the group whose lesson is on; otherwise the scanner has to say', async () => {
    // One group's lesson fills the half of the day we are in; the other group meets in the other half.
    const morning = hourNow() < 12;
    const [a] = morning ? [['14:00', '15:00']] : [['01:00', '02:00']];
    const on = await group('on now', { scheduleDays: todayName(), startTime: morning ? '00:05' : '12:05', endTime: morning ? '11:55' : '23:55' });
    const later = await group('later', { scheduleDays: todayName(), startTime: a[0], endTime: a[1] });
    const s = await student('two groups', [on, later]);
    expect((await scan(owner, s).expect(201)).body.group.id).toBe(on);
    expect((await marksOf(s)).map((m) => m.groupId)).toEqual([on]);
    // Two groups, neither lesson on: which one?
    const l1 = await group('later one', { scheduleDays: todayName(), startTime: a[0], endTime: a[1] });
    const [b] = hourNow() < 12 ? [['16:00', '17:00']] : [['03:00', '04:00']];
    const l2 = await group('later two', { scheduleDays: todayName(), startTime: b[0], endTime: b[1] });
    const s2 = await student('two later', [l1, l2]);
    const unclear = await scan(owner, s2).expect(400);
    expect(unclear.body.code).toBe('GROUP_AMBIGUOUS');
    expect(unclear.body.groups.map((g: { groupId: string }) => g.groupId).sort()).toEqual([l1, l2].sort());
    expect(await marksOf(s2)).toEqual([]);
    expect((await scan(owner, s2, { groupId: l2 }).expect(201)).body.group.id).toBe(l2);
  });

  it('a teacher scans for their own group or a lesson given to them, nobody else\'s', async () => {
    const teacherUser = async (local: string) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `qr-${local}-${suffix}@test.uz`, role: 'TEACHER' }).expect(201)).body;
      const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `QR ${local}`, password: 'password12345' }).expect(201)).body;
      const id = (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: `QR ${local}`, userId: acc.user.id, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id as string;
      return { token: acc.accessToken as string, id };
    };
    const t1 = await teacherUser('t1');
    const t2 = await teacherUser('t2');
    const t3 = await teacherUser('t3');
    const g = await group('teacher', { ...allDay, teacherId: t1.id });
    const [row] = await rowsOf(g);
    const s = await student('teacher', [g]);
    await scan(t3.token, s).expect(403);
    await scan(t2.token, s).expect(403);
    expect(await marksOf(s)).toEqual([]);
    // The lesson is given to another teacher for today (a substitute on the row).
    await http().patch(`/api/schedule/${row.id}`).set(bearer(owner)).send({ teacherId: t2.id, allowCollision: true }).expect(200);
    await scan(t2.token, s).expect(201);
    expect((await scan(t1.token, s).expect(201)).body.alreadyMarked).toBe(true);
  });

  it('the day is the center\'s own day, and another date is checked like any mark', async () => {
    const g = await group('zone', allDay);
    const [row] = await rowsOf(g);
    const s = await student('zone', [g]);
    // Yesterday, named: that day's lesson (the same weekly row one day earlier has none - the group meets today's weekday).
    const lastWeek = dateOf(tashkent(-7));
    expect((await scan(owner, s, { date: lastWeek }).expect(201)).body.attendance).toMatchObject({ date: lastWeek, scheduleId: row.id });
    expect((await scan(owner, s, { date: dateOf(tashkent(-1)) }).expect(409)).body.code).toBe('NO_LESSON_TODAY');
    await scan(owner, s, { date: 'yesterday' }).expect(400);

    // A center far to the east is already in tomorrow: its scan is dated there.
    const [center] = await db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    await db.update(tenants).set({ timezone: 'Pacific/Kiritimati' }).where(eq(tenants.id, tenantId));
    try {
      const there = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati' }).format(new Date());
      const weekday = new Date(`${there}T00:00:00Z`).getUTCDay() || 7;
      const far = await group('far east', { scheduleDays: DAYS[weekday], startTime: '00:05', endTime: '23:55' });
      const s2 = await student('far east', [far]);
      expect((await scan(owner, s2).expect(201)).body.attendance.date).toBe(there);
      expect(await db.select().from(attendance).where(and(eq(attendance.studentId, s2), eq(attendance.date, there)))).toHaveLength(1);
    } finally {
      await db.update(tenants).set({ timezone: center.tz }).where(eq(tenants.id, tenantId));
    }
  });

  it('the debt shown is this month\'s debt, as the payments page has it - not "has paid before"', async () => {
    const g = await group('paid', { ...allDay, monthlyPrice: 400_000 });
    const s = await student('paid', [g]);
    const month = today().slice(0, 7);
    const ledger = async () => ((await http().get(`/api/payments/debtors?forMonth=${month}`).set(bearer(owner)).expect(200)).body.debtors as Array<{ studentId: string; debtAmount: number; paidAmount: number }>).find((d) => d.studentId === s);
    // A payment for a month long past: it used to make the scan say "no debt".
    await http().post('/api/payments').set(bearer(owner)).send({ studentId: s, amount: 400_000, forMonth: '2025-01', method: 'CASH' }).expect(201);
    const first = (await scan(owner, s).expect(201)).body.finance;
    const due = await ledger();
    expect(first).toMatchObject({ forMonth: month, hasDebt: true, debt: due!.debtAmount, paid: due!.paidAmount, monthlyPrice: 400_000 });
    expect(first.debt).toBe(400_000);
    // Part of this month paid: still a debtor, by the amount the ledger says.
    await http().post('/api/payments').set(bearer(owner)).send({ studentId: s, amount: 150_000, forMonth: month, method: 'CASH' }).expect(201);
    expect((await scan(owner, s).expect(201)).body.finance).toMatchObject({ hasDebt: true, debt: 250_000, paid: 150_000 });
    await http().post('/api/payments').set(bearer(owner)).send({ studentId: s, amount: 250_000, forMonth: month, method: 'CASH' }).expect(201);
    expect((await scan(owner, s).expect(201)).body.finance).toMatchObject({ hasDebt: false, debt: 0 });
    expect((await ledger())?.debtAmount ?? 0).toBe(0);
  });
});
