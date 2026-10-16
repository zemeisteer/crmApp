import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { teacherAttendance } from '../src/db/schema.js';

// A teacher's mark is per lesson, like a student's: a group's morning and
// evening lessons on one day each have their own mark and substitute, and the
// payroll counts lessons the same way for planned, absent, late and covered.
describe('Teacher attendance per lesson, and the payroll (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  let main: string, sub: string, rowTeacher: string, group: string, am: string, pm: string, tue: string;
  // 2031-03 has five Mondays (3, 10, 17, 24, 31) and four Tuesdays (4, 11, 18, 25).
  const day = async (date: string) => (await http().get(`/api/teacher-attendance?date=${date}`).set(auth()).expect(200)).body
    .filter((l: { groupId: string }) => l.groupId === group);
  const mark = (date: string, entries: Array<Record<string, unknown>>) => http().post('/api/teacher-attendance').set(auth()).send({ date, entries });
  const payroll = async () => {
    const all = (await http().get('/api/salary-payments/calculate?forMonth=2031-03').set(auth()).expect(200)).body.teachers;
    return (id: string) => all.find((x: { teacherId: string }) => x.teacherId === id);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    token = (await http().post('/api/auth/register')
      .send({ centerName: `TAL ${suffix}`, subdomain: `tal-${suffix}`, email: `tal-${suffix}@test.uz`, password: 'password123', fullName: 'Owner TAL' })
      .expect(201)).body.accessToken;
    const teacher = async (fullName: string) => (await http().post('/api/teachers').set(auth()).send({ fullName, subject: 'Math', salaryType: 'PER_LESSON', salaryValue: 100_000 }).expect(201)).body.id as string;
    main = await teacher('TAL Main');
    sub = await teacher('TAL Sub');
    rowTeacher = await teacher('TAL Row Teacher');
    group = (await http().post('/api/groups').set(auth()).send({ name: 'TAL Twice', subject: 'Math', teacherId: main }).expect(201)).body.id;
    const row = async (body: Record<string, unknown>) => (await http().post('/api/schedule').set(auth()).send({ groupId: group, ...body }).expect(201)).body.id as string;
    am = await row({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' });
    pm = await row({ dayOfWeek: 1, startTime: '18:00', endTime: '19:00' });
    // Tuesdays the timetable row names its own teacher, not the group's.
    tue = await row({ dayOfWeek: 2, startTime: '12:00', endTime: '13:00', teacherId: rowTeacher });
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  it('two lessons of one group on one day: two entries, each with its own mark and substitute', async () => {
    expect((await day('2031-03-10')).map((l: { scheduleId: string; startTime: string; status: null }) => [l.scheduleId, l.startTime, l.status])).toEqual([[am, '09:00', null], [pm, '18:00', null]]);

    // Naming no lesson on a day with two: refused, nothing written.
    expect((await mark('2031-03-10', [{ groupId: group, status: 'PRESENT' }]).expect(400)).body.code).toBe('LESSON_AMBIGUOUS');

    const saved = (await mark('2031-03-10', [
      { groupId: group, scheduleId: am, status: 'PRESENT' },
      { groupId: group, scheduleId: pm, status: 'ABSENT', substituteTeacherId: sub, note: 'kasal' },
    ]).expect(201)).body.filter((l: { groupId: string }) => l.groupId === group);
    expect(saved.map((l: { status: string; substituteTeacherId: string | null }) => [l.status, l.substituteTeacherId])).toEqual([['PRESENT', null], ['ABSENT', sub]]);

    // Re-marking one lesson leaves the other alone.
    await mark('2031-03-10', [{ groupId: group, scheduleId: am, status: 'LATE' }]).expect(201);
    expect((await day('2031-03-10')).map((l: { status: string }) => l.status)).toEqual(['LATE', 'ABSENT']);
    const rows = await db.select().from(teacherAttendance).where(and(eq(teacherAttendance.groupId, group), eq(teacherAttendance.date, '2031-03-10')));
    expect(rows.map((r) => [r.scheduleId, r.status, r.teacherId, r.startTime]).sort()).toEqual([[am, 'LATE', main, '09:00'], [pm, 'ABSENT', main, '18:00']].sort());
  });

  it('a batch with one bad entry saves nothing', async () => {
    await mark('2031-03-03', [
      { groupId: group, scheduleId: am, status: 'PRESENT' },
      { groupId: group, scheduleId: pm, status: 'ABSENT', substituteTeacherId: main }, // a teacher cannot cover their own lesson
    ]).expect(400);
    expect((await day('2031-03-03')).map((l: { status: null }) => l.status)).toEqual([null, null]);
    // The same lesson twice in one batch: refused.
    await mark('2031-03-03', [{ groupId: group, scheduleId: am, status: 'PRESENT' }, { groupId: group, scheduleId: am, status: 'LATE' }]).expect(400);
  });

  it('the lesson\'s teacher is the timetable row\'s; a lesson called off is listed and cannot be marked', async () => {
    const tuesday = await day('2031-03-11');
    expect(tuesday).toHaveLength(1);
    expect(tuesday[0]).toMatchObject({ scheduleId: tue, teacherId: rowTeacher, teacherName: 'TAL Row Teacher' });
    await mark('2031-03-11', [{ groupId: group, scheduleId: tue, status: 'ABSENT' }]).expect(201);
    const [r] = await db.select().from(teacherAttendance).where(and(eq(teacherAttendance.scheduleId, tue), eq(teacherAttendance.date, '2031-03-11')));
    expect(r.teacherId).toBe(rowTeacher);

    await http().post('/api/lessons/cancellations').set(auth()).send({ groupId: group, date: '2031-03-17', scheduleId: pm, reason: 'Bayram' }).expect(201);
    const called = await day('2031-03-17');
    expect(called.map((l: { scheduleId: string; cancelled: boolean }) => [l.scheduleId, l.cancelled])).toEqual([[am, false], [pm, true]]);
    await mark('2031-03-17', [{ groupId: group, scheduleId: pm, status: 'PRESENT' }]).expect(400);
    // The day still has two lessons (one called off): the lesson must be named.
    await mark('2031-03-17', [{ groupId: group, status: 'PRESENT' }]).expect(400);
    await mark('2031-03-17', [{ groupId: group, scheduleId: am, status: 'PRESENT' }]).expect(201);
  });

  it('an old mark for the whole day is not copied onto both lessons, nor counted twice', async () => {
    // As migration 0058 leaves it: a day-level mark on a day with two lessons.
    await db.insert(teacherAttendance).values({ tenantId: (await db.query.groups.findFirst({ where: (g, { eq: e }) => e(g.id, group) }))!.tenantId, groupId: group, teacherId: main, date: '2031-03-24', status: 'ABSENT', scheduleId: null });
    const both = await day('2031-03-24');
    expect(both.map((l: { status: null; dayStatus: string }) => [l.status, l.dayStatus])).toEqual([[null, 'ABSENT'], [null, 'ABSENT']]);
  });

  it('the payroll counts lessons in one unit: planned, absent, late and covered', async () => {
    // A mark of a lesson that is then called off is not counted.
    await mark('2031-03-31', [{ groupId: group, scheduleId: pm, status: 'LATE' }]).expect(201);
    await http().post('/api/lessons/cancellations').set(auth()).send({ groupId: group, date: '2031-03-31', scheduleId: pm, reason: 'Ko\'chirildi' }).expect(201);

    const of = await payroll();
    // Main: 5 Mondays x 2 lessons, minus the evening of the 17th and of the 31st called off = 8.
    // Absent: the evening of the 10th, and the old day-level mark of the 24th once = 2. Late: the morning of the 10th.
    expect(of(main).details).toMatchObject({ plannedLessons: 8, absentLessons: 2, lateLessons: 1, substitutedLessons: 0, unmatchedMarks: 1 });
    expect(of(main).details.lessonCount).toBe(6);
    expect(of(main).calculatedSalary).toBe(600_000);
    // Sub covered the evening of the 10th: one lesson.
    expect(of(sub).details).toMatchObject({ plannedLessons: 0, substitutedLessons: 1 });
    expect(of(sub).calculatedSalary).toBe(100_000);
    // Tuesdays are the row teacher's: 4 planned, one absent.
    expect(of(rowTeacher).details).toMatchObject({ plannedLessons: 4, absentLessons: 1 });
    expect(of(rowTeacher).calculatedSalary).toBe(300_000);
  });
});
