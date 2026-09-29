import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Parents in the cabinet: signing in with the parent's phone or a PARENT
// account gives a "parent" session that can watch but not act for the child.
describe('Portal for parents (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const tail = (n: number) => String(suffix + n).slice(-7);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Parent ${suffix}`, subdomain: `parent-${suffix}`, email: `parent-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('tells parent from student by the phone used, and parents only watch', async () => {
    const own = `+99893${tail(1)}`;
    const parentPhone = `+99894${tail(2)}`;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Kid One' }).expect(201)).body.id as string;
    await http().patch(`/api/students/${kid}`).set(auth()).send({ phone: own, parentPhone }).expect(200);
    const hw = (await http().post('/api/groups').set(auth()).send({ name: 'Parents G', subject: 'Math' }).expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${hw}`).set(auth()).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;

    const asParent = (await http().post('/api/portal/auth/phone/verify').send({ phone: parentPhone, pin }).expect(201)).body;
    expect(asParent.viewer).toBe('parent');
    const asStudent = (await http().post('/api/portal/auth/phone/verify').send({ phone: own, pin }).expect(201)).body;
    expect(asStudent.viewer).toBe('student');

    const p = { Authorization: `Bearer ${asParent.accessToken}` };
    const s = { Authorization: `Bearer ${asStudent.accessToken}` };
    expect((await http().get('/api/portal/me').set(p).expect(200)).body).toMatchObject({ id: kid, viewer: 'parent' });
    expect((await http().get('/api/portal/me').set(s).expect(200)).body.viewer).toBe('student');

    // Parents can see everything...
    await http().get('/api/portal/schedule').set(p).expect(200);
    await http().get('/api/portal/payments').set(p).expect(200);
    await http().get('/api/portal/homework').set(p).expect(200);
    // ...but the child's own work and AI conversation stay the child's.
    await http().post('/api/portal/homework/any-id/submit').set(p).expect(403);
    await http().get('/api/portal/exams/any-id/start').set(p).expect(403);
    await http().get('/api/portal/ai').set(p).expect(403);
    await http().post('/api/portal/ai/ask').set(p).send({ message: 'salom' }).expect(403);
    await http().get('/api/portal/ai').set(s).expect(200);
  });

  it("gives a PARENT account a session for each linked child", async () => {
    const kids = [] as string[];
    for (const name of ['Anvar Kid', 'Laylo Kid']) {
      kids.push((await http().post('/api/students').set(auth()).send({ fullName: name }).expect(201)).body.id as string);
    }
    const inv = await http().post('/api/invitations').set(auth()).send({ email: `mom-${suffix}@test.uz`, role: 'PARENT' }).expect(201);
    const accepted = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: 'Mom', password: 'password12345' }).expect(201)).body;
    const mom = { Authorization: `Bearer ${accepted.accessToken}` };

    // Not linked yet: nothing to show.
    await http().post('/api/portal/auth/parent-account').set(mom).expect(404);
    for (const k of kids) await http().post(`/api/students/${k}/guardians`).set(auth()).send({ userId: accepted.user.id }).expect(201);

    const res = (await http().post('/api/portal/auth/parent-account').set(mom).expect(201)).body;
    expect(res.sessions.map((x: { student: { fullName: string } }) => x.student.fullName).sort()).toEqual(['Anvar Kid', 'Laylo Kid']);
    expect(res.sessions.every((x: { viewer: string }) => x.viewer === 'parent')).toBe(true);
    const first = { Authorization: `Bearer ${res.sessions[0].accessToken}` };
    expect((await http().get('/api/portal/me').set(first).expect(200)).body.viewer).toBe('parent');

    // Only PARENT accounts use this door.
    await http().post('/api/portal/auth/parent-account').set(auth()).expect(403);
    await http().post('/api/portal/auth/parent-account').expect(401);
  });
});
