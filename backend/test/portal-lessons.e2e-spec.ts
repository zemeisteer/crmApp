import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// The cabinet's past lessons (attendance, homework, results per lesson day)
// and signing in on a center's own subdomain.
describe('Portal past lessons and subdomain sign-in (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });
  const phone = `+99897${String(suffix).slice(-7)}`;
  const localDay = (offsetDays: number) => new Date(Date.now() + 5 * 3600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Lessons ${suffix}`, subdomain: `lessons-${suffix}`, email: `lessons-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('shows past lessons with attendance and homework, and scopes sign-in to the subdomain', async () => {
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Lesson Kid', phone }).expect(201)).body.id as string;
    const group = (await http().post('/api/groups').set(auth())
      .send({ name: 'Every Day', subject: 'Ingliz tili', scheduleDays: 'Dushanba,Seshanba,Chorshanba,Payshanba,Juma,Shanba,Yakshanba', startTime: '09:00' })
      .expect(201)).body.id as string;
    await http().post(`/api/students/${kid}/enroll/${group}`).set(auth()).expect(201);
    const yesterday = localDay(-1);
    await http().post('/api/attendance').set(auth()).send({ groupId: group, date: yesterday, entries: [{ studentId: kid, status: 'LATE' }] }).expect(201);
    await http().post('/api/homework').set(auth()).send({ groupIds: [group], title: 'Workbook p.12', description: 'Ex. 1-3' }).expect(201);
    const { pin } = (await http().post(`/api/students/${kid}/portal-pin`).set(auth()).expect(201)).body;

    // Another center's subdomain does not know this phone; the own one does.
    await http().post('/api/portal/auth/phone/verify').send({ phone, pin, subdomain: `nope-${suffix}` }).expect(401);
    const session = (await http().post('/api/portal/auth/phone/verify').send({ phone, pin, subdomain: `lessons-${suffix}` }).expect(201)).body;
    const s = { Authorization: `Bearer ${session.accessToken}` };

    const res = (await http().get('/api/portal/lessons?days=7').set(s).expect(200)).body;
    const past = res.lessons.find((l: { date: string }) => l.date === yesterday);
    expect(past).toMatchObject({ groupName: 'Every Day', attendance: 'LATE' });
    const todays = res.lessons.find((l: { date: string }) => l.date === res.today);
    expect(todays.homework).toEqual([expect.objectContaining({ title: 'Workbook p.12', description: 'Ex. 1-3' })]);
  });
});
