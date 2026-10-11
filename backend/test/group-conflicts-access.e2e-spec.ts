import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// GET /api/groups/schedule-conflicts (the group form's live check): who may
// ask about which group, and that a student's name reaches only someone who
// may see students - in no field of the answer.
describe('Group form conflict check: access and what it tells (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const tashkent = (offsetDays: number) => new Date(Date.now() + 5 * 3_600_000 + offsetDays * 86_400_000);
  const dateOf = (d: Date) => d.toISOString().slice(0, 10);
  const dow = (d: Date) => (d.getUTCDay() === 0 ? 7 : d.getUTCDay());
  const next = (w: number) => { for (let i = 1; i <= 7; i++) if (dow(tashkent(i)) === w) return dateOf(tashkent(i)); throw new Error('unreachable'); };
  const last = (w: number) => { for (let i = 1; i <= 7; i++) if (dow(tashkent(-i)) === w) return dateOf(tashkent(-i)); throw new Error('unreachable'); };
  const DAYS = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
  const SECRET_A = 'Maxfiy Ismli';
  const SECRET_B = 'Sirli Oquvchi';

  let owner: string, ownerB: string;
  let onlyGroups: string, noStudents: string, full: string, teacher: string;
  let tch1: string, tch2: string, gMon: string, gWed: string, edited: string;

  const ask = (token: string, q: Record<string, string | undefined>) => {
    const qs = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    return http().get(`/api/groups/schedule-conflicts?${qs}`).set(bearer(token));
  };
  const text = (res: { body: unknown }) => JSON.stringify(res.body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    const register = async (key: string) => (await http().post('/api/auth/register')
      .send({ centerName: `GCA ${key} ${suffix}`, subdomain: `gca-${key}-${suffix}`, email: `gca-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body.accessToken as string;
    owner = await register('a');
    ownerB = await register('b');
    const staff = async (local: string, role: string, access: string[] | null) => {
      const inv = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `gca-${local}-${suffix}@test.uz`, role }).expect(201)).body;
      const acc = (await http().post(`/api/invitations/${inv.token}/accept`).send({ fullName: `GCA ${local}`, password: 'password12345' }).expect(201)).body;
      if (access) await http().patch(`/api/staff/${acc.user.id}`).set(bearer(owner)).send({ access }).expect(200);
      return { token: acc.accessToken as string, userId: acc.user.id as string };
    };
    onlyGroups = (await staff('only', 'MANAGER', ['groups.view', 'groups.edit'])).token;
    noStudents = (await staff('nostu', 'MANAGER', ['groups.view', 'groups.edit', 'schedule.view', 'schedule.edit'])).token;
    full = (await staff('full', 'MANAGER', ['groups.view', 'groups.edit', 'schedule.view', 'schedule.edit', 'students.view'])).token;
    const t = await staff('teacher', 'TEACHER', ['groups.view', 'groups.edit', 'schedule.view', 'students.view', 'schedule.edit']);
    teacher = t.token;
    const mk = async (name: string, userId?: string) => (await http().post('/api/teachers').set(bearer(owner)).send({ fullName: name, userId, subject: 'English', salaryType: 'FIXED', salaryValue: 1_000_000 }).expect(201)).body.id as string;
    tch1 = await mk('GCA Teacher One', t.userId);
    tch2 = await mk('GCA Teacher Two');
    const group = async (name: string, teacherId: string, day: number, start: string, end: string) => (await http().post('/api/groups').set(bearer(owner))
      .send({ name, subject: 'English', teacherId, scheduleDays: DAYS[day], startTime: start, endTime: end, maxStudents: 10 }).expect(201)).body.id as string;
    gMon = await group('GCA Monday', tch1, 1, '10:00', '11:00');
    gWed = await group('GCA Wednesday', tch2, 3, '10:00', '11:00');
    edited = await group('GCA Edited', tch2, 2, '09:00', '10:00');
    let seq = 0;
    const student = async (name: string, groupIds: string[]) => (await http().post('/api/students').set(bearer(owner))
      .send({ fullName: name, phone: `+9987${String(suffix).slice(-6)}${String(++seq).padStart(2, '0')}`, groupIds }).expect(201)).body.id as string;
    // In the edited group and in the Wednesday group: an ordinary lesson clash on Wednesday.
    await student(SECRET_A, [edited, gWed]);
    // In the edited group, with a make-up session next Thursday 14:00.
    const s2 = await student(SECRET_B, [edited]);
    const missed = last(2);
    await http().post('/api/attendance').set(bearer(owner)).send({ groupId: edited, date: missed, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);
    const credit = (await http().post('/api/makeups/credits').set(bearer(owner)).send({ studentId: s2, groupId: edited, date: missed, reason: 'ABSENT' }).expect(201)).body.id;
    await http().post(`/api/makeups/credits/${credit}/book`).set(bearer(owner)).send({ mode: 'SESSION', date: next(4), startTime: '14:00', endTime: '15:00', teacherId: tch2 }).expect(201);
  }, 180_000);

  afterAll(async () => { await app?.close(); });

  const lessonClash = { teacherId: undefined as unknown as string, days: DAYS[1], startTime: '10:30', endTime: '11:30' };
  const studentClash = { days: DAYS[3], startTime: '10:30', endTime: '11:30' };
  const makeupClash = { days: DAYS[4], startTime: '14:00', endTime: '15:00' };

  it('an ordinary lesson clash names the group and the time - to everyone who may edit groups', async () => {
    for (const token of [owner, onlyGroups, noStudents, full]) {
      const res = await ask(token, { ...lessonClash, teacherId: tch1, excludeId: edited }).expect(200);
      expect(res.body).toEqual([expect.objectContaining({ id: gMon, name: 'GCA Monday', startTime: '10:00-11:00' })]);
    }
  });

  it('a student is named only to someone who plans the timetable and may see students - in no field for anyone else', async () => {
    // A student of the edited group has a make-up session then: the clash has no group to name.
    const seen = await ask(owner, { ...makeupClash, teacherId: tch1, excludeId: edited }).expect(200);
    expect(text(seen)).toContain(SECRET_B);
    expect(text(await ask(full, { ...makeupClash, teacherId: tch1, excludeId: edited }).expect(200))).toContain(SECRET_B);

    for (const token of [onlyGroups, noStudents]) {
      const res = await ask(token, { ...makeupClash, teacherId: tch1, excludeId: edited }).expect(200);
      // The clash is reported - as a count.
      expect(res.body).toHaveLength(1);
      expect(text(res)).toContain("1 nafar o'quvchi");
      expect(text(res)).not.toContain(SECRET_B);
      expect(text(res)).not.toContain('Sirli');
      // The session's teacher is busy too: a teacher's name is the timetable, not a student.
      const busy = await ask(token, { ...makeupClash, teacherId: tch2, excludeId: edited }).expect(200);
      expect(text(busy)).toContain('GCA Teacher Two');
      expect(text(busy)).not.toContain('Sirli');
      // A shared student with another group: the group is named, never the student.
      const shared = await ask(token, { ...studentClash, teacherId: tch1, excludeId: edited }).expect(200);
      expect(shared.body).toEqual([expect.objectContaining({ id: gWed, name: 'GCA Wednesday' })]);
      expect(text(shared)).not.toContain('Maxfiy');
    }
  });

  it('the group asked about must be reachable: not another center, not a made-up id, and for a teacher only their own', async () => {
    // Another center: its own id space only.
    await ask(ownerB, { ...makeupClash, teacherId: tch1, excludeId: edited }).expect(404);
    expect((await ask(ownerB, { ...lessonClash, teacherId: tch1 }).expect(200)).body).toEqual([]);
    await ask(owner, { ...lessonClash, teacherId: tch1, excludeId: 'no-such-group' }).expect(404);
    // The other center's teacher asked about from here: nothing, like a teacher that does not exist.
    expect((await ask(owner, { ...lessonClash, teacherId: 'no-such-teacher', excludeId: edited }).expect(200)).body).toEqual([]);

    // A teacher allowed to edit groups: their own group, yes; someone else's or a new one, no.
    await ask(teacher, { ...makeupClash, teacherId: tch1, excludeId: edited }).expect(403);
    await ask(teacher, { ...makeupClash, teacherId: tch1 }).expect(403);
    const own = await ask(teacher, { days: DAYS[3], startTime: '10:30', endTime: '11:30', teacherId: tch2, excludeId: gMon }).expect(200);
    expect(own.body).toEqual([expect.objectContaining({ id: gWed })]);
    // Without groups.edit the question is not answered at all.
    const plain = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `gca-plain-${suffix}@test.uz`, role: 'RECEPTIONIST' }).expect(201)).body;
    const acc = (await http().post(`/api/invitations/${plain.token}/accept`).send({ fullName: 'GCA plain', password: 'password12345' }).expect(201)).body;
    await ask(acc.accessToken, { ...lessonClash, teacherId: tch1, excludeId: edited }).expect(403);
  });
});
