import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { payments } from '../src/db/schema.js';

// The cash desk by the center's day (Asia/Tashkent): what came in and went
// out, what should be in the drawer, and closing the day once.
describe('Cash desk day (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const tokens: Record<string, string> = {};
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const tz = 'Asia/Tashkent';
  const dayOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 86_400_000));
  const month = today.slice(0, 7);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Cash ${suffix}`, subdomain: `cash-${suffix}`, email: `cash-${suffix}@test.uz`, password: 'password123', fullName: 'Cash Owner' })
      .expect(201)).body;
    tokens.OWNER = reg.accessToken;
    for (const role of ['ACCOUNTANT', 'RECEPTIONIST', 'TEACHER']) {
      const inv = await http().post('/api/invitations').set(as('OWNER')).send({ email: `cash-${role.toLowerCase()}-${suffix}@test.uz`, role }).expect(201);
      tokens[role] = (await http().post(`/api/invitations/${inv.body.token}/accept`).send({ fullName: `${role} person`, password: 'password12345' }).expect(201)).body.accessToken;
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('adds up the day, closes it once and shows what came after', async () => {
    const kid = (await http().post('/api/students').set(as('OWNER')).send({ fullName: 'Cash Kid' }).expect(201)).body.id as string;
    const pay = (token: string, amount: number, method: string, paidAt?: string) =>
      http().post('/api/payments').set(as(token)).send({ studentId: kid, amount, method, forMonth: month, ...(paidAt ? { paidAt } : {}) }).expect(201);
    const p1 = (await pay('OWNER', 300_000, 'CASH')).body;
    await pay('ACCOUNTANT', 200_000, 'CLICK');
    await pay('ACCOUNTANT', 100_000, 'CASH');
    // 23:30 yesterday in Tashkent is the same UTC day as today's morning there - it belongs to yesterday.
    const lateYesterday = new Date(`${yesterday}T23:30:00+05:00`).toISOString();
    await pay('OWNER', 70_000, 'CASH', lateYesterday);
    await http().post('/api/expenses').set(as('OWNER')).send({ title: 'Bo\'r', category: 'OTHER', amount: 30_000, paymentMethod: 'CASH', date: today }).expect(201);
    await http().post('/api/expenses').set(as('OWNER')).send({ title: 'Ijara', category: 'RENT', amount: 500_000, paymentMethod: 'BANK_TRANSFER', date: today }).expect(201);
    expect((await db.select().from(payments).where(eq(payments.id, p1.id)))[0].recordedById).toBeTruthy();

    const day = (await http().get('/api/cash/day').set(as('RECEPTIONIST')).expect(200)).body;
    expect(day).toMatchObject({ date: today, timezone: tz, totalIn: 600_000, totalOut: 530_000, expectedCash: 370_000, closed: null });
    expect(day.in.CASH).toEqual({ amount: 400_000, count: 2 });
    expect(day.byCashier.map((c: { name: string; cash: number; other: number }) => [c.name, c.cash, c.other])).toEqual([
      ['ACCOUNTANT person', 100_000, 200_000],
      ['Cash Owner', 300_000, 0],
    ]);
    const prev = (await http().get(`/api/cash/day?date=${yesterday}`).set(as('OWNER')).expect(200)).body;
    expect(prev).toMatchObject({ totalIn: 70_000, expectedCash: 70_000 });

    // Only finance closes; never twice; never a future day.
    await http().post('/api/cash/day/close').set(as('RECEPTIONIST')).send({ date: today, countedCash: 1 }).expect(403);
    const tomorrow = dayOf(new Date(Date.now() + 2 * 86_400_000));
    await http().post('/api/cash/day/close').set(as('OWNER')).send({ date: tomorrow, countedCash: 1 }).expect(400);
    const [a, b] = await Promise.all([
      http().post('/api/cash/day/close').set(as('ACCOUNTANT')).send({ date: today, countedCash: 360_000, note: 'Kam chiqdi' }),
      http().post('/api/cash/day/close').set(as('OWNER')).send({ date: today, countedCash: 360_000 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const closed = (a.status === 201 ? a : b).body.closed;
    expect(closed).toMatchObject({ expectedCash: 370_000, countedCash: 360_000, difference: -10_000, changedAfterClosing: 0 });

    // A cash payment recorded for today after closing is shown apart.
    await pay('OWNER', 20_000, 'CASH');
    const after = (await http().get(`/api/cash/day?date=${today}`).set(as('OWNER')).expect(200)).body;
    expect(after.closed).toMatchObject({ expectedCash: 370_000, countedCash: 360_000, changedAfterClosing: 20_000 });
    expect(after.payments.filter((p: { afterClosing: boolean }) => p.afterClosing).map((p: { amount: number }) => p.amount)).toEqual([20_000]);

    const hist = (await http().get(`/api/cash/closings?month=${month}`).set(as('OWNER')).expect(200)).body;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ date: today, difference: -10_000 });
  });

  it('keeps the cash desk from teachers, and validates the date', async () => {
    await http().get('/api/cash/day').set(as('TEACHER')).expect(403);
    await http().get('/api/cash/day?date=2026-02-30').set(as('OWNER')).expect(400);
    await http().get('/api/cash/day?date=05.10.2026').set(as('OWNER')).expect(400);
    await http().get('/api/cash/closings?month=bad').set(as('OWNER')).expect(400);
  });
});
