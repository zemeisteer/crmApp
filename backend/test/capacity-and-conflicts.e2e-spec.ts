import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, users } from '../src/db/schema.js';

// Regressions for two pre-existing defects found in the admissions audit:
//  - direct enrollment (students.create groupIds / POST enroll) ignored
//    groups.maxStudents and was racy;
//  - the schedule conflict engine matched one-off lessons against weekly
//    slots on any date, and missed dated lessons clashing with weekly ones.
describe('Group capacity & schedule day alignment (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    const res = await http()
      .post('/api/auth/register')
      .send({ centerName: `Cap ${suffix}`, subdomain: `cap-${suffix}`, email: `cap-${suffix}@test.uz`, password: 'password123', fullName: 'Cap Owner' })
      .expect(201);
    token = res.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  const mkGroup = async (name: string, maxStudents: number) =>
    (await http().post('/api/groups').set(auth()).send({ name, subject: 'Math', maxStudents }).expect(201)).body.id as string;
  const mkStudent = (fullName: string, groupIds?: string[]) =>
    http().post('/api/students').set(auth()).send({ fullName, groupIds });

  it('rejects creating a student into a full group and keeps nothing', async () => {
    const g = await mkGroup('One Seat', 1);
    await mkStudent('Seat Taker', [g]).expect(201);
    const res = await mkStudent('Too Late', [g]).expect(409);
    expect(res.body.code).toBe('GROUP_FULL');
    const students = await http().get('/api/students').set(auth()).expect(200);
    expect(students.body.some((s: { fullName: string }) => s.fullName === 'Too Late')).toBe(false);
  });

  it('enforces capacity on POST enroll, also under concurrency', async () => {
    const g = await mkGroup('Two Seats', 2);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await mkStudent(`Racer ${i}`).expect(201)).body.id);

    const results = await Promise.all(ids.map((id) => http().post(`/api/students/${id}/enroll/${g}`).set(auth())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);

    const group = await http().get(`/api/groups/${g}`).set(auth()).expect(200);
    expect(group.body.enrollments.filter((e: { status: string }) => e.status === 'ACTIVE')).toHaveLength(2);
  });

  it('still reports "already enrolled" for a member of a full group', async () => {
    const g = await mkGroup('Full Club', 1);
    const s = (await mkStudent('Member', [g]).expect(201)).body.id;
    await http().post(`/api/students/${s}/enroll/${g}`).set(auth()).expect(400);
  });

  it('aligns one-off and weekly lessons by weekday', async () => {
    const teacher = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Busy Teacher', subject: 'Math', phone: '+998905550123' }).expect(201)).body.id;
    const g1 = await mkGroup('Weekly', 20);
    const g2 = await mkGroup('Extra', 20);
    // Weekly on Monday 09:00-10:30. 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
    await http().post('/api/schedule').set(auth()).send({ groupId: g1, teacherId: teacher, dayOfWeek: 1, startTime: '09:00', endTime: '10:30' }).expect(201);

    // Same teacher, same time, on a Tuesday: no clash (previously a false 409).
    await http().post('/api/schedule').set(auth())
      .send({ groupId: g2, teacherId: teacher, date: '2026-10-06', isRecurring: false, startTime: '09:30', endTime: '10:00' })
      .expect(201);

    // On a Monday: clashes with the weekly lesson (previously missed).
    const clash = await http().post('/api/schedule').set(auth())
      .send({ groupId: g2, teacherId: teacher, date: '2026-10-05', isRecurring: false, startTime: '09:30', endTime: '10:00' })
      .expect(409);
    expect(clash.body.conflicts.some((c: { type: string }) => c.type === 'TEACHER')).toBe(true);
  });

  it('builds weekly timetable lessons from the group form and refuses teacher clashes', async () => {
    const teacher = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Clash Teacher' }).expect(201)).body.id as string;
    const lessons = async (groupId: string) =>
      ((await http().get(`/api/schedule?groupId=${groupId}`).set(auth()).expect(200)).body as Array<{ dayOfWeek: number; startTime: string; endTime: string }>)
        .map((l) => `${l.dayOfWeek} ${l.startTime}-${l.endTime}`).sort();

    const a = (await http().post('/api/groups').set(auth())
      .send({ name: 'Weekly A', subject: 'Math', teacherId: teacher, scheduleDays: 'Dushanba,Chorshanba', startTime: '16:00' })
      .expect(201)).body.id as string;
    expect(await lessons(a)).toEqual(['1 16:00-17:30', '3 16:00-17:30']);

    // Same teacher, Monday 17:00 overlaps 16:00-17:30.
    const clash = await http().post('/api/groups').set(auth())
      .send({ name: 'Weekly B', subject: 'Math', teacherId: teacher, scheduleDays: 'Dushanba', startTime: '17:00' })
      .expect(409);
    expect(clash.body.code).toBe('TEACHER_SCHEDULE_CONFLICT');
    const b = (await http().post('/api/groups').set(auth())
      .send({ name: 'Weekly B', subject: 'Math', teacherId: teacher, scheduleDays: 'Dushanba', startTime: '17:30', endTime: '19:00' })
      .expect(201)).body.id as string;
    expect(await lessons(b)).toEqual(['1 17:30-19:00']);

    // Editing the days rebuilds the rows; renaming alone does not re-check.
    await http().patch(`/api/groups/${a}`).set(auth()).send({ scheduleDays: 'Seshanba,Payshanba' }).expect(200);
    expect(await lessons(a)).toEqual(['2 16:00-17:30', '4 16:00-17:30']);
    await http().patch(`/api/groups/${a}`).set(auth()).send({ name: 'Weekly A2' }).expect(200);
    await http().patch(`/api/groups/${a}`).set(auth()).send({ startTime: '18:00', endTime: '17:00' }).expect(400);

    // Deleted groups disappear from the timetable.
    await http().delete(`/api/groups/${b}`).set(auth()).expect(200);
    expect(await lessons(b)).toEqual([]);
  });

  it('lets a student join two directions but not two lessons at the same time', async () => {
    const group = async (name: string, subject: string, scheduleDays: string, startTime: string) =>
      (await http().post('/api/groups').set(auth()).send({ name, subject, scheduleDays, startTime }).expect(201)).body.id as string;
    const math = await group('Clash Math', 'Matematika', 'Dushanba,Chorshanba', '16:00');
    const english = await group('Clash English', 'Ingliz tili', 'Dushanba', '17:00');
    const englishTue = await group('Clash English Tue', 'Ingliz tili', 'Seshanba', '16:00');

    const clash = await mkStudent('Busy Kid', [math, english]).expect(409);
    expect(clash.body.code).toBe('STUDENT_SCHEDULE_CONFLICT');

    const kid = (await mkStudent('Two Directions', [math, englishTue]).expect(201)).body.id as string;
    const detail = await http().get(`/api/students/${kid}`).set(auth()).expect(200);
    expect(detail.body.enrollments.filter((e: { status: string }) => e.status === 'ACTIVE')).toHaveLength(2);

    const late = await http().post(`/api/students/${kid}/enroll/${english}`).set(auth()).expect(409);
    expect(late.body.code).toBe('STUDENT_SCHEDULE_CONFLICT');
  });

  it('shares a placement test by link and grades mixed question types', async () => {
    const reading = 'Registan Square is surrounded by three large madrasas.';
    const questions = [
      { type: 'MCQ', section: '1. Multiple choice', prompt: 'She ___ a teacher.', options: ['am', 'is', 'are', 'be'], correctAnswer: 'B', level: 1 },
      { type: 'TRUE_FALSE_NG', section: '2. Reading', passage: reading, prompt: 'There are three madrasas.', correctAnswer: 'T', level: 2 },
      { type: 'FILL_BLANK', prompt: 'Past tense of buy: ___', correctAnswer: 'bought', level: 3 },
      { type: 'MATCHING', prompt: 'Match', points: 2, pairs: [{ left: 'reliable', right: 'able to be trusted' }, { left: 'enormous', right: 'extremely large' }], level: 2 },
      { type: 'ESSAY', prompt: 'Write an email to a friend (60-80 words).', points: 4, rubric: 'content, format, language' },
    ];
    // A question with no answer is refused, not silently dropped.
    await http().post('/api/placement-tests').set(auth())
      .send({ subject: 'Ingliz tili', questions: [...questions, { type: 'MCQ', prompt: 'no answer', options: ['a', 'b'] }] }).expect(400);
    const created = (await http().post('/api/placement-tests').set(auth()).send({ subject: 'Ingliz tili', title: 'Level check', questions }).expect(201)).body;
    expect(created.questions).toHaveLength(5);

    // The public view never exposes answers; matching gives both columns.
    const pub = (await http().get(`/api/public/placement/${created.token}`).expect(200)).body;
    expect(pub.questions).toHaveLength(5);
    expect(JSON.stringify(pub)).not.toMatch(/correctAnswer|bought|rubric/);
    expect(pub.questions[1]).toMatchObject({ passage: reading, section: '2. Reading', options: [{ id: 'true' }, { id: 'false' }, { id: 'ng' }] });
    expect(pub.questions[3].left).toEqual(['reliable', 'enormous']);

    const matching = JSON.stringify({ 0: 'able to be trusted', 1: 'extremely large' });
    const res = (await http().post(`/api/public/placement/${created.token}/submit`)
      .send({ fullName: 'New Kid', phone: '+998901112233', answers: ['B', 'true', ' Bought. ', matching, 'Dear Ali, come to Samarkand in May...'] }).expect(201)).body;
    // 1 + 1 + 1 + 2 of 9 points; the essay (4) waits for the teacher.
    expect(res).toMatchObject({ correct: 5, total: 9, pending: true });

    const attempts = (await http().get(`/api/placement-tests/${created.id}/attempts`).set(auth()).expect(200)).body;
    expect(attempts[0]).toMatchObject({ fullName: 'New Kid', reviewStatus: 'PENDING' });
    const listed = (await http().get('/api/placement-tests').set(auth()).expect(200)).body.find((x: { id: string }) => x.id === created.id);
    expect(listed).toMatchObject({ attempts: 1, pending: 1 });
    const graded = (await http().post(`/api/placement-tests/${created.id}/attempts/${attempts[0].id}/grade`).set(auth()).send({ scores: { 4: 3 } }).expect(201)).body;
    expect(graded).toMatchObject({ reviewStatus: 'DONE', earned: 8, total: 9, percent: 89 });

    // The applicant is filed as a lead, with the result on its card and
    // timeline; a second attempt with the same phone joins the same lead.
    const leadId = attempts[0].leadId as string;
    expect(leadId).toBeTruthy();
    const lead = (await http().get(`/api/leads/${leadId}`).set(auth()).expect(200)).body;
    expect(lead).toMatchObject({ fullName: 'New Kid', source: 'WEBSITE', status: 'NEW', origin: { channel: 'PLACEMENT_TEST' } });
    expect(lead.placementAttempts[0]).toMatchObject({ testTitle: 'Level check', percent: 89, reviewStatus: 'DONE' });
    await http().post(`/api/public/placement/${created.token}/submit`)
      .send({ fullName: 'New Kid', phone: '+998 90 111 22 33', answers: ['A', '', '', '', ''] }).expect(201);
    const again = (await http().get(`/api/leads/${leadId}`).set(auth()).expect(200)).body;
    expect(again.placementAttempts).toHaveLength(2);
    const timeline = (await http().get(`/api/leads/${leadId}/timeline`).set(auth()).expect(200)).body as Array<{ metadata?: { kind?: string } }>;
    expect(timeline.filter((a) => a.metadata?.kind === 'PLACEMENT_TEST')).toHaveLength(2);

    // Rename, then closing the test stops the link.
    await http().patch(`/api/placement-tests/${created.id}`).set(auth()).send({ title: 'B1 check' }).expect(200);
    await http().patch(`/api/placement-tests/${created.id}`).set(auth()).send({ active: false }).expect(200);
    await http().get(`/api/public/placement/${created.token}`).expect(404);
  });

  it('lets a student take their group exam in the portal once', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Portal Exam Group', subject: 'Math' }).expect(201)).body.id as string;
    const phone = `+99890${String(suffix).slice(-7)}`;
    const kid = (await mkStudent('Portal Kid', [g]).expect(201)).body.id as string;
    await http().patch(`/api/students/${kid}`).set(auth()).send({ phone }).expect(200);
    const exams = (await http().post('/api/exams').set(auth()).send({ groupIds: [g], title: 'Portal quiz', maxScore: 10 }).expect(201)).body;
    const examId = (Array.isArray(exams) ? exams[0] : exams).id as string;
    await http().post(`/api/exams/${examId}/questions/batch`).set(auth()).send({ questions: [
      { prompt: '2+2', questionType: 'MCQ', options: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }], correctAnswer: 'B', points: 1 },
      { prompt: 'Past of go', questionType: 'SHORT_ANSWER', options: [], correctAnswer: 'went', points: 1 },
    ] }).expect(201);

    // A phone number alone no longer logs in; the center-issued PIN does.
    await http().post('/api/portal/auth/phone').send({ phone }).expect(404);
    await http().post('/api/portal/auth/telegram').send({ chatId: '1' }).expect(404);
    expect((await http().post('/api/portal/auth/phone/start').send({ phone }).expect(201)).body).toEqual({ telegramSent: false, pinAvailable: false });
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;
    expect(pin).toMatch(/^\d{6}$/);
    expect((await http().get(`/api/students/${kid}`).set(auth()).expect(200)).body).not.toHaveProperty('pinHash');
    expect((await http().post('/api/portal/auth/phone/start').send({ phone }).expect(201)).body.pinAvailable).toBe(true);
    await http().post('/api/portal/auth/phone/verify').send({ phone, pin: pin === '000000' ? '111111' : '000000' }).expect(401);
    const portal = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken as string;
    const p = () => ({ Authorization: `Bearer ${portal}` });
    const list = (await http().get('/api/portal/exams/available').set(p()).expect(200)).body;
    expect(list.find((e: { id: string }) => e.id === examId)).toMatchObject({ questionCount: 2, taken: false });

    const started = (await http().get(`/api/portal/exams/${examId}/start`).set(p()).expect(200)).body;
    expect(JSON.stringify(started.questions)).not.toMatch(/correctAnswer|went/);
    const ids = started.questions.map((q: { id: string }) => q.id);
    const res = (await http().post(`/api/portal/exams/${examId}/submit`).set(p()).send({ answers: { [ids[0]]: 'B', [ids[1]]: 'Went' } }).expect(201)).body;
    expect(res).toMatchObject({ earnedPoints: 2, totalPoints: 2, score: 10 });

    // One attempt only.
    await http().get(`/api/portal/exams/${examId}/start`).set(p()).expect(400);
    const after = (await http().get('/api/portal/exams/available').set(p()).expect(200)).body;
    expect(after.find((e: { id: string }) => e.id === examId)).toMatchObject({ taken: true, score: 10 });
  });

  it('counts a payment taken before the month invoice existed', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Early Payers', subject: 'Math', monthlyPrice: 300_000 }).expect(201)).body.id as string;
    const kid = (await mkStudent('Early Payer', [g]).expect(201)).body.id as string;
    const month = '2031-02';
    await http().post('/api/payments').set(auth()).send({ studentId: kid, amount: 300_000, method: 'CASH', forMonth: month }).expect(201);
    await http().post(`/api/invoices/generate-monthly?forMonth=${month}`).set(auth()).send({ forMonth: month }).expect(201);
    const list = (await http().get(`/api/invoices?forMonth=${month}`).set(auth()).expect(200)).body;
    const rows = (Array.isArray(list) ? list : list.items) as Array<{ studentId: string; status: string; remainingAmount: number }>;
    expect(rows.find((r) => r.studentId === kid)).toMatchObject({ status: 'PAID', remainingAmount: 0 });
  });

  it('qualifies a contacted lead without a trial lesson, no reason asked', async () => {
    const lead = (await http().post('/api/leads').set(auth()).send({ fullName: 'Skip Trial', phone: `+99893${String(suffix).slice(-7)}`, source: 'PHONE' }).expect(201)).body;
    await http().post(`/api/leads/${lead.id}/transition`).set(auth()).send({ toStatus: 'CONTACTED' }).expect(201);
    const res = await http().post(`/api/leads/${lead.id}/transition`).set(auth()).send({ toStatus: 'QUALIFIED' }).expect(201);
    expect(res.body.status).toBe('QUALIFIED');
  });

  it('marks teacher attendance and takes missed lessons off the payroll', async () => {
    const teacher = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Payroll Teacher', salaryType: 'FIXED', salaryValue: 2_000_000 }).expect(201)).body.id as string;
    const sub = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Sub Teacher', salaryType: 'PER_LESSON', salaryValue: 50_000 }).expect(201)).body.id as string;
    const g = (await http().post('/api/groups').set(auth())
      .send({ name: 'Monday Group', subject: 'Math', teacherId: teacher, scheduleDays: 'Dushanba', startTime: '08:00', endTime: '09:00' }).expect(201)).body.id as string;

    // 2031-03 has five Mondays: 3, 10, 17, 24, 31.
    const day = (await http().get('/api/teacher-attendance?date=2031-03-10').set(auth()).expect(200)).body;
    expect(day.find((l: { groupId: string }) => l.groupId === g)).toMatchObject({ teacherId: teacher, status: null });
    await http().get('/api/teacher-attendance?date=2031-03-11').set(auth()).expect(200)
      .then((r) => expect(r.body.find((l: { groupId: string }) => l.groupId === g)).toBeUndefined());

    await http().post('/api/teacher-attendance').set(auth())
      .send({ date: '2031-03-10', entries: [{ groupId: g, status: 'ABSENT', substituteTeacherId: sub }] }).expect(201);

    const payroll = (await http().get('/api/salary-payments/calculate?forMonth=2031-03').set(auth()).expect(200)).body;
    const main = payroll.teachers.find((x: { teacherId: string }) => x.teacherId === teacher);
    expect(main.details).toMatchObject({ plannedLessons: 5, absentLessons: 1, deduction: 400_000 });
    expect(main.calculatedSalary).toBe(1_600_000);
    const cover = payroll.teachers.find((x: { teacherId: string }) => x.teacherId === sub);
    expect(cover).toMatchObject({ calculatedSalary: 50_000 });
  });

  it('grades exams with mixed types and lets the teacher score essays', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Essay Group', subject: 'English' }).expect(201)).body.id as string;
    const kid = (await mkStudent('Essay Kid', [g]).expect(201)).body.id as string;
    const exams = (await http().post('/api/exams').set(auth()).send({ groupIds: [g], title: 'Unit test', maxScore: 100 }).expect(201)).body;
    const examId = (Array.isArray(exams) ? exams[0] : exams).id as string;
    const created = (await http().post(`/api/exams/${examId}/questions/batch`).set(auth()).send({ questions: [
      { type: 'WORD_ORDER', prompt: 'always / she / on / arrives / time', correctAnswer: 'She always arrives on time.', points: 1 },
      { type: 'ERROR_CORRECTION', prompt: 'We need to do a decision before Friday.', correctAnswer: 'We need to make a decision before Friday.|make', points: 1 },
      { type: 'ESSAY', prompt: 'Describe your city.', points: 2, rubric: 'content and grammar' },
    ] }).expect(201)).body;
    expect(created.map((q: { type: string }) => q.type)).toEqual(['WORD_ORDER', 'ERROR_CORRECTION', 'ESSAY']);

    const start = (await http().get(`/api/exams/${examId}/start-attempt?studentId=${kid}`).set(auth()).expect(200)).body;
    expect(start.questions[0].words).toEqual(['always', 'she', 'on', 'arrives', 'time']);
    const ids = start.questions.map((q: { id: string }) => q.id);
    const res = (await http().post(`/api/exams/${examId}/submit-attempt`).set(auth())
      .send({ studentId: kid, answers: { [ids[0]]: 'she always arrives on time', [ids[1]]: 'make', [ids[2]]: 'My city is Tashkent...' } }).expect(201)).body;
    expect(res).toMatchObject({ earnedPoints: 2, totalPoints: 4, pending: true, score: 50 });

    const graded = (await http().post(`/api/exams/${examId}/attempts/${res.attempt.id}/grade`).set(auth()).send({ scores: { [ids[2]]: 2 } }).expect(201)).body;
    expect(graded).toMatchObject({ reviewStatus: 'DONE', earnedPoints: 4, score: 100, passed: true });
  });

  it('attaches an AI task to homework as a PDF and renders materials', async () => {
    const teacher = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Hw Teacher' }).expect(201)).body.id as string;
    const g = (await http().post('/api/groups').set(auth())
      .send({ name: 'Hw Group', subject: 'English', teacherId: teacher, scheduleDays: 'Seshanba', startTime: '10:00', endTime: '11:00' }).expect(201)).body.id as string;
    const [hw] = (await http().post('/api/homework').set(auth()).send({ groupIds: [g], title: 'Unit 5', description: 'Faylni bajaring.' }).expect(201)).body;
    const content = '## 1-mashq\n1. She (live) here since 2020.\n- Ўзбекча: ғ, қ\n**Muhim**';
    const updated = (await http().post(`/api/homework/${hw.id}/attachment-text`).set(auth()).send({ title: 'Unit 5: Present Perfect', content }).expect(201)).body;
    expect(updated.attachmentName).toBe('Unit-5-Present-Perfect.pdf');
    expect(updated.attachmentPath).toMatch(/\.pdf$/);

    const pdf = await http().post('/api/ai/pdf').set(auth()).send({ title: 'Material', content }).expect(201);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('gives a teacher a login that sees only their own groups', async () => {
    const tid = (await http().post('/api/teachers').set(auth()).send({ fullName: 'Login Teacher', subject: 'Math' }).expect(201)).body.id as string;
    const mine = (await http().post('/api/groups').set(auth()).send({ name: 'Mine', subject: 'Math', maxStudents: 5, teacherId: tid, scheduleDays: 'Dushanba', startTime: '09:00', endTime: '10:00' }).expect(201)).body.id as string;
    await http().post('/api/groups').set(auth()).send({ name: 'Not mine', subject: 'Math', maxStudents: 5, scheduleDays: 'Dushanba', startTime: '11:00', endTime: '12:00' }).expect(201);

    const email = `teacher-${suffix}@test.uz`;
    const linked = (await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email, password: 'secret123' }).expect(201)).body;
    expect(linked.user).toMatchObject({ email });
    await http().post(`/api/teachers/${tid}/account`).set(auth()).send({ email, password: 'secret123' }).expect(409);

    const login = (await http().post('/api/auth/login').send({ email, password: 'secret123' }).expect(201)).body;
    const groups = (await http().get('/api/groups').set({ Authorization: `Bearer ${login.accessToken}` }).expect(200)).body;
    expect(groups.map((g: { id: string }) => g.id)).toEqual([mine]);

    // A user id from another center cannot be linked.
    const other = (await http().post('/api/auth/register').send({ centerName: `Other ${suffix}`, subdomain: `other-${suffix}`, email: `other-${suffix}@test.uz`, password: 'password123', fullName: 'Other Owner' }).expect(201)).body;
    await http().post('/api/teachers').set(auth()).send({ fullName: 'Hijack', userId: other.user.id }).expect(400);

    // Taking the login away.
    const unlinked = (await http().delete(`/api/teachers/${tid}/account`).set(auth()).expect(200)).body;
    expect(unlinked.userId).toBeNull();
  });

  it('shows the superadmin every center with its numbers and nobody else', async () => {
    await http().get('/api/tenants/overview').set(auth()).expect(403);
    const email = `super-${suffix}@test.uz`;
    const reg = (await http().post('/api/auth/register').send({ centerName: `Super ${suffix}`, subdomain: `super-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
    // A platform superadmin has no center membership of their own.
    const db = app.get<Database>(DB);
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, reg.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, reg.user.id));
    const tokenSa = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken as string;
    const res = (await http().get('/api/tenants/overview').set({ Authorization: `Bearer ${tokenSa}` }).expect(200)).body;
    const mine = res.items.find((i: { subdomain: string }) => i.subdomain === `cap-${suffix}`);
    expect(mine).toMatchObject({ owner: { email: `cap-${suffix}@test.uz` } });
    expect(mine.students).toBeGreaterThan(0);
    expect(res.totals.centers).toBeGreaterThanOrEqual(2);
  });
});
