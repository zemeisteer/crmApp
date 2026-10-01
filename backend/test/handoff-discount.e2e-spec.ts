import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';

describe('Session handoff and payment discounts (e2e)', () => {
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
      .send({ centerName: `Hand ${suffix}`, subdomain: `hand-${suffix}`, email: `hand-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("carries a staff session to the center's address with a one-time code", async () => {
    const h = (await http().post('/api/auth/handoff').set(auth()).expect(201)).body;
    expect(h.subdomain).toBe(`hand-${suffix}`);
    expect(h.code).toMatch(/^[0-9a-f]{64}$/);

    const session = (await http().post('/api/auth/handoff/exchange').send({ code: h.code }).expect(201)).body;
    expect(session.tenant.subdomain).toBe(`hand-${suffix}`);
    expect(session.user.email).toBe(`hand-${suffix}@test.uz`);
    await http().get('/api/auth/me').set({ Authorization: `Bearer ${session.accessToken}` }).expect(200);

    // Single use, and nothing for guesses or the signed-out.
    await http().post('/api/auth/handoff/exchange').send({ code: h.code }).expect(401);
    await http().post('/api/auth/handoff/exchange').send({ code: 'f'.repeat(64) }).expect(401);
    await http().post('/api/auth/handoff/exchange').send({}).expect(401);
    await http().post('/api/auth/handoff').expect(401);
  });

  it('a discount given with a payment also closes the invoice, and the receipt has the name', async () => {
    const g = (await http().post('/api/groups').set(auth()).send({ name: 'Disc G', subject: 'Math', monthlyPrice: 450_000 }).expect(201)).body.id as string;
    const kid = (await http().post('/api/students').set(auth()).send({ fullName: 'Discount Kid', groupIds: [g] }).expect(201)).body.id as string;
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

    // 450 000 price, 10 000 off: 440 000 is paid.
    const p = (await http().post('/api/payments').set(auth()).send({ studentId: kid, amount: 440_000, discount: 10_000, forMonth: month, method: 'CASH' }).expect(201)).body;
    expect(p).toMatchObject({ amount: 440_000, discount: 10_000 });
    expect(p.student.fullName).toBe('Discount Kid');
    expect(p.student.enrollments[0].group.name).toBe('Disc G');
    if (p.invoice) {
      const inv = (await http().get(`/api/payments/${p.id}`).set(auth()).expect(200)).body.invoice;
      expect(inv.remainingAmount).toBe(0);
      expect(inv.status).toBe('PAID');
    }

    const debt = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(auth()).expect(200)).body;
    expect(debt.totalDebt).toBe(0);
    await http().post('/api/payments').set(auth()).send({ studentId: kid, amount: 1000, discount: -5, forMonth: month, method: 'CASH' }).expect(400);
  });
});
