import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

// Leaving is recorded (when + why) and the director's report reads it,
// together with money and debt that match the payments page.
describe('Director report (e2e)', () => {
  let app: INestApplication<App>;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    owner = (await http().post('/api/auth/register')
      .send({ centerName: `Dir ${suffix}`, subdomain: `dir-${suffix}`, email: `dir-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('records leaving with a reason, and reports churn, debt and money', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Dir G', subject: 'Math', monthlyPrice: 400_000 }).expect(201)).body.id as string;
    const mk = async (name: string) => (await http().post('/api/students').set(auth()).send({ fullName: name, groupIds: [g] }).expect(201)).body.id as string;
    const a = await mk('Payer');
    await mk('Debtor');
    const c = await mk('Leaver');
    // The center's month (Asia/Tashkent), as the server counts it.
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    await http().post('/api/payments').set(auth()).send({ studentId: a, amount: 400_000, forMonth: month, method: 'CASH' }).expect(201);

    await http().patch(`/api/students/${c}`).set(auth()).send({ status: 'LEFT', leftReason: 'NOT_A_REASON' }).expect(400);
    const left = (await http().patch(`/api/students/${c}`).set(auth()).send({ status: 'LEFT', leftReason: 'SCHEDULE' }).expect(200)).body;
    expect(left).toMatchObject({ status: 'LEFT', leftReason: 'SCHEDULE' });
    expect(left.leftAt).toBeTruthy();

    const r = (await http().get('/api/reports/director').set(auth()).expect(200)).body;
    const now = r.trend.at(-1);
    expect(r.trend).toHaveLength(12);
    expect(now).toMatchObject({ collected: 400_000, expected: 800_000, debt: 400_000, left: 1 });
    expect(r.debtors.items.map((d: { fullName: string }) => d.fullName)).toEqual(['Debtor']);
    expect(r.churn.reasonsLast3Months).toEqual({ SCHEDULE: 1 });
    expect(r.churn.leavers[0]).toMatchObject({ fullName: 'Leaver', reason: 'SCHEDULE', groups: ['Dir G'] });

    // Same debt as the payments page.
    const pay = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(auth()).expect(200)).body;
    expect(pay.totalDebt).toBe(now.debt);

    // Coming back clears the leaving data.
    const back = (await http().patch(`/api/students/${c}`).set(auth()).send({ status: 'ACTIVE' }).expect(200)).body;
    expect(back).toMatchObject({ status: 'ACTIVE', leftAt: null, leftReason: null });

    await http().get('/api/reports/director?month=2999-01').set(auth()).expect(400);
    await http().get('/api/reports/director?month=bad').set(auth()).expect(400);
  });

  it('is for managers and finance, not teachers', async () => {
    const inv = await http().post('/api/invitations').set(auth()).send({ email: `dir-t-${suffix}@test.uz`, role: 'TEACHER' }).expect(201);
    const teacher = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: 'T', password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/reports/director').set({ Authorization: `Bearer ${teacher}` }).expect(403);
  });
});
