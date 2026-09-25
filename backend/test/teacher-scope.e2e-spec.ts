import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Teachers work only with their own groups, and user rows embedded in
// responses never carry password/token hashes.
describe('Teacher scope and safe user fields (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  let s1: string;
  let s2: string;
  let g1: string;
  let g2: string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();

    tokens.OWNER = (await http().post('/api/auth/register')
      .send({ centerName: `Scope ${suffix}`, subdomain: `scope-${suffix}`, email: `scope-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    for (const [who, role] of [['T1', 'TEACHER'], ['T2', 'TEACHER'], ['PARENT', 'PARENT']]) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `${who.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      const acc = await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${who} user`, password: 'password12345' }).expect(201);
      tokens[who] = acc.body.accessToken;
      userIds[who] = acc.body.user.id;
    }
    const teacher = async (who: string) =>
      (await http().post('/api/teachers').set(as('OWNER')).send({ fullName: `${who} teacher`, userId: userIds[who], subject: 'Math' }).expect(201)).body.id as string;
    const t1 = await teacher('T1');
    const t2 = await teacher('T2');
    g1 = (await http().post('/api/groups').set(as('OWNER')).send({ name: 'G1', subject: 'Math', teacherId: t1 }).expect(201)).body.id;
    g2 = (await http().post('/api/groups').set(as('OWNER')).send({ name: 'G2', subject: 'Math', teacherId: t2 }).expect(201)).body.id;
    s1 = (await http().post('/api/students').set(as('OWNER')).send({ fullName: 'Student One', phone: '+998901110001', groupIds: [g1] }).expect(201)).body.id;
    s2 = (await http().post('/api/students').set(as('OWNER')).send({ fullName: 'Student Two', phone: '+998901110002', groupIds: [g2] }).expect(201)).body.id;
    await http().post('/api/attendance').set(as('OWNER')).send({ groupId: g1, date: today, entries: [{ studentId: s1, status: 'PRESENT' }] }).expect(201);
    await http().post('/api/attendance').set(as('OWNER')).send({ groupId: g2, date: today, entries: [{ studentId: s2, status: 'ABSENT' }] }).expect(201);
    await http().post(`/api/students/${s1}/guardians`).set(as('OWNER')).send({ userId: userIds.PARENT, relationship: 'MOTHER' }).expect(201);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('shows a teacher only the students of their own groups', async () => {
    const list = await http().get('/api/students').set(as('T1')).expect(200);
    expect(list.body.map((s: { id: string }) => s.id)).toEqual([s1]);
    const own = await http().get(`/api/students/${s1}`).set(as('T1')).expect(200);
    expect(own.body.payments).toEqual([]);
    await http().get(`/api/students/${s2}`).set(as('T1')).expect(404);
    await http().get(`/api/students/${s2}/guardians`).set(as('T1')).expect(404);
    // Admins still see everyone.
    const all = await http().get('/api/students').set(as('OWNER')).expect(200);
    expect(all.body).toHaveLength(2);
  });

  it("shows a teacher only their own groups' attendance", async () => {
    const t1 = await http().get('/api/attendance').set(as('T1')).expect(200);
    expect(t1.body.map((a: { groupId: string }) => a.groupId)).toEqual([g1]);
    const t2 = await http().get(`/api/attendance?groupId=${g1}`).set(as('T2')).expect(200);
    expect(t2.body).toEqual([]);
    const owner = await http().get('/api/attendance').set(as('OWNER')).expect(200);
    expect(owner.body).toHaveLength(2);
  });

  it("refuses QR check-in of a student outside the teacher's groups", async () => {
    await http().post('/api/attendance/qr-checkin').set(as('T1')).send({ code: s2 }).expect(403);
    await http().post('/api/attendance/qr-checkin').set(as('T1')).send({ code: s1 }).expect(201);
  });

  it('never returns password or token hashes in embedded user rows', async () => {
    const forbidden = ['passwordHash', 'resetTokenHash', 'verifyTokenHash', 'twoFactorSecret'];
    const check = (user: Record<string, unknown>) => {
      for (const key of forbidden) expect(user, key).not.toHaveProperty(key);
    };
    const one = await http().get(`/api/students/${s1}`).set(as('OWNER')).expect(200);
    check(one.body.guardians[0].user);
    const list = await http().get('/api/students').set(as('OWNER')).expect(200);
    check(list.body.find((s: { id: string }) => s.id === s1).guardians[0].user);
    const guardians = await http().get(`/api/students/${s1}/guardians`).set(as('OWNER')).expect(200);
    check(guardians.body[0].user);

    const ann = await http().post('/api/announcements').set(as('OWNER')).send({ title: 'Hello', content: 'World' }).expect(201);
    const read = await http().get(`/api/announcements/${ann.body.id}`).set(as('OWNER')).expect(200);
    check(read.body.author);
    expect(read.body.author.fullName).toBe('Owner');
  });
});
