import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

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
});
