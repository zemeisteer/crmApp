import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// The timetable's conflict check and the write are one serialized step:
// requests that arrive together cannot both book the same teacher or room.
describe('Schedule conflicts under concurrency (e2e)', () => {
  let app: NestExpressApplication;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  let auth: Record<string, string>;
  let teacher: string, room: string, gA: string, gB: string, gC: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Race ${suffix}`, subdomain: `race-${suffix}`, email: `race-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' }).expect(201)).body;
    auth = { Authorization: `Bearer ${reg.accessToken}` };
    teacher = (await http().post('/api/teachers').set(auth).send({ fullName: 'Race T', subject: 'Math' }).expect(201)).body.id;
    room = (await http().post('/api/schedule/rooms').set(auth).send({ name: 'Race Room', capacity: 10 }).expect(201)).body.id;
    const mk = async (name: string) => (await http().post('/api/groups').set(auth).send({ name, subject: 'Math' }).expect(201)).body.id as string;
    gA = await mk('Race A');
    gB = await mk('Race B');
    gC = await mk('Race C');
  }, 120_000);

  afterAll(async () => { await app?.close(); });

  it('the same teacher at the same time from three groups at once: exactly one lesson', async () => {
    const res = await Promise.all([gA, gB, gC].map((groupId) =>
      http().post('/api/schedule').set(auth).send({ groupId, teacherId: teacher, dayOfWeek: 3, startTime: '15:00', endTime: '16:00', isRecurring: true })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });

  it('the same room at overlapping times from two groups at once: exactly one lesson', async () => {
    const res = await Promise.all([gB, gC].map((groupId, i) =>
      http().post('/api/schedule').set(auth).send({ groupId, roomId: room, dayOfWeek: 4, startTime: i ? '10:30' : '10:00', endTime: i ? '11:30' : '11:00', isRecurring: true })));
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('two moves into the same slot at once: exactly one', async () => {
    const a = (await http().post('/api/schedule').set(auth).send({ groupId: gA, roomId: room, dayOfWeek: 5, startTime: '08:00', endTime: '09:00', isRecurring: true }).expect(201)).body.id;
    const b = (await http().post('/api/schedule').set(auth).send({ groupId: gB, roomId: room, dayOfWeek: 5, startTime: '12:00', endTime: '13:00', isRecurring: true }).expect(201)).body.id;
    const res = await Promise.all([a, b].map((id) => http().patch(`/api/schedule/${id}`).set(auth).send({ startTime: '17:00', endTime: '18:00' })));
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});
