import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { TelegramService } from '../src/telegram/telegram.service.js';

// Paying by card transfer: the center shows its card in the cabinet, the
// student sends a receipt, the staff hear of it in Telegram and confirm it -
// only then is it a payment, once - or reject it with a reason.
describe('Card transfer payments (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer());
  let owner: Record<string, string>;
  let portal: Record<string, string>;
  let studentId: string;
  const told: Array<{ chat: string; text: string }> = [];
  const studentTold: string[] = [];
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    const tg = app.get(TelegramService);
    tg.sendMessage = (async (chat: string, text: string) => {
      told.push({ chat, text });
      return 1;
    }) as typeof tg.sendMessage;
    tg.notifyStudent = (async (_id: string, text: string) => {
      studentTold.push(text);
    }) as typeof tg.notifyStudent;

    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Card ${suffix}`, subdomain: `card-${suffix}`, email: `card-${suffix}@test.uz`, password: 'password123', fullName: 'Card Owner' })
      .expect(201)).body;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    const { DB } = await import('../src/db/db.module.js');
    const { users } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    await app.get(DB).update(users).set({ telegramChatId: `3${tail}` }).where(eq(users.id, reg.user.id));

    const phone = `+99894${tail}`;
    const g = (await http().post('/api/groups').set(owner).send({ name: 'Card Group', subject: 'Math', monthlyPrice: 400_000 }).expect(201)).body.id as string;
    studentId = (await http().post('/api/students').set(owner).send({ fullName: 'Card Payer', phone, groupIds: [g] }).expect(201)).body.id;
    const { pin } = (await http().post(`/api/students/${studentId}/portal-pin`).set(owner).expect(201)).body;
    portal = { Authorization: `Bearer ${(await http().post('/api/portal/auth/phone/verify').send({ phone, pin }).expect(201)).body.accessToken}` };
  });

  afterAll(async () => {
    await app?.close();
  });

  const send = (amount: string, file = true) => {
    const r = http().post('/api/portal/card-payment').set(portal).field('amount', amount).field('forMonth', '2026-11');
    return file ? r.attach('file', png, { filename: 'chek.png', contentType: 'image/png' }) : r;
  };

  it('no card, no transfers; the admin sets a card and the cabinet shows it', async () => {
    expect((await http().get('/api/portal/card-payment').set(portal).expect(200)).body.card).toBeNull();
    await send('300000').expect(400);
    await http().put('/api/card-payments/card').set(owner).send({ cardNumber: '8600 1234', cardHolder: 'Ali Valiyev' }).expect(400);
    await http().put('/api/card-payments/card').set(owner).send({ cardNumber: '8600 1234 5678 9012', cardHolder: 'Ali Valiyev' }).expect(200);
    expect((await http().get('/api/portal/card-payment').set(portal).expect(200)).body.card).toEqual({ number: '8600 1234 5678 9012', holder: 'Ali Valiyev' });
  });

  it('the student sends a receipt; the staff hear of it and confirm it into one payment', async () => {
    await send('300000', false).expect(400); // the picture is required
    await send('5').expect(400);
    const claim = (await send('300000').expect(201)).body;
    expect(claim.status).toBe('PENDING');
    await new Promise((r) => setTimeout(r, 200));
    expect(told.at(-1)).toMatchObject({ chat: `3${tail}` });
    expect(told.at(-1)!.text).toContain('Card Payer');

    const list = (await http().get('/api/card-payments/claims?status=PENDING').set(owner).expect(200)).body;
    expect(list.pending).toBe(1);
    // The receipt opens for staff through a signed link, and for the student who sent it.
    const staffLinks = (await http().post('/api/files/sign').set(owner).send({ names: [list.items[0].receiptFile] }).expect(201)).body;
    expect(Object.keys(staffLinks)).toHaveLength(1);

    // The amount seen on the receipt is what counts.
    const done = (await http().post(`/api/card-payments/claims/${claim.id}/confirm`).set(owner).send({ amount: 250000 }).expect(201)).body;
    expect(done.status).toBe('CONFIRMED');
    await http().post(`/api/card-payments/claims/${claim.id}/confirm`).set(owner).send({}).expect(409);
    const payments = (await http().get(`/api/payments?studentId=${studentId}`).set(owner).expect(200)).body;
    const rows = (Array.isArray(payments) ? payments : payments.items) as Array<{ id: string; amount: number; method: string }>;
    expect(rows.filter((p) => p.id === done.paymentId)).toEqual([expect.objectContaining({ amount: 250000, method: 'BANK_TRANSFER' })]);
    expect(studentTold.at(-1)).toContain('tasdiqlandi');
    const mine = (await http().get('/api/portal/card-payment').set(portal).expect(200)).body.claims;
    expect(mine[0]).toMatchObject({ status: 'CONFIRMED', amount: 250000 });
  });

  it('a rejected receipt says why; it never becomes a payment', async () => {
    const claim = (await send('100000').expect(201)).body;
    await http().post(`/api/card-payments/claims/${claim.id}/reject`).set(owner).send({ reason: '' }).expect(400);
    await http().post(`/api/card-payments/claims/${claim.id}/reject`).set(owner).send({ reason: "Chekda summa ko'rinmaydi" }).expect(201);
    await http().post(`/api/card-payments/claims/${claim.id}/confirm`).set(owner).send({}).expect(409);
    expect(studentTold.at(-1)).toContain("summa ko'rinmaydi");
    const mine = (await http().get('/api/portal/card-payment').set(portal).expect(200)).body.claims;
    expect(mine[0]).toMatchObject({ status: 'REJECTED', rejectReason: "Chekda summa ko'rinmaydi" });
  });

  it('teachers do not see the receipts', async () => {
    await http().post('/api/staff').set(owner).send({ email: `card-t-${suffix}@test.uz`, fullName: 'Card Teacher', role: 'TEACHER', password: 'password12345' }).expect(201);
    const t = (await http().post('/api/auth/login').send({ email: `card-t-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/card-payments/claims').set({ Authorization: `Bearer ${t}` }).expect(403);
  });
});
