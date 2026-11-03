import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { auditLogs, invoices, paymentAllocations, payments } from '../src/db/schema.js';

// Taking back a payment entered by mistake: the row stays (VOIDED, with who
// and why), its money comes off the invoices it was on, and it no longer
// counts anywhere money is counted. Refused where that would leave
// something else wrong; a teacher cannot; another center cannot see it.
describe('Voiding a payment (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let owner: string, teacher: string, other: string;
  const month = '2026-11';

  const register = async (key: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Void ${key} ${suffix}`, subdomain: `void-${key}-${suffix}`, email: `void-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}` })
      .expect(201)).body.accessToken as string;
  const student = async (name: string) => (await http().post('/api/students').set(bearer(owner)).send({ fullName: name }).expect(201)).body.id as string;
  const invoice = async (studentId: string, amount: number) =>
    (await http().post('/api/invoices').set(bearer(owner)).send({ studentId, amount, dueDate: '2026-11-10', forMonth: month }).expect(201)).body.id as string;
  const pay = async (body: Record<string, unknown>) => (await http().post('/api/payments').set(bearer(owner)).send({ forMonth: month, method: 'BANK_TRANSFER', ...body }).expect(201)).body.id as string;
  const voidIt = (id: string, reason = "Noto'g'ri o'quvchiga yozilgan", token = owner) => http().post(`/api/payments/${id}/void`).set(bearer(token)).send({ reason });
  const inv = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0];

  beforeAll(async () => {
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    owner = await register('a');
    other = await register('b');
    const i = (await http().post('/api/invitations').set(bearer(owner)).send({ email: `void-t-${suffix}@test.uz`, role: 'TEACHER' }).expect(201)).body;
    teacher = (await http().post(`/api/invitations/${i.token}/accept`).send({ fullName: 'Teacher', password: 'password12345' }).expect(201)).body.accessToken;
  }, 120_000);
  afterAll(async () => { await app?.close(); });

  it('the money comes off the invoice; the payment stays, VOIDED, with who and why; it leaves the totals', async () => {
    const s = await student('Void Kid');
    const invId = await invoice(s, 400_000);
    const before = (await http().get(`/api/payments/finance-summary?forMonth=${month}`).set(bearer(owner)).expect(200)).body.totalRevenue as number;
    const id = await pay({ studentId: s, amount: 300_000, invoiceId: invId });
    expect(await inv(invId)).toMatchObject({ amountPaid: 300_000, remainingAmount: 100_000, status: 'PARTIALLY_PAID' });

    await voidIt(id, '  ').expect(400);
    await voidIt(id, 'x', teacher).expect(403);
    await voidIt(id, 'x', other).expect(404);
    expect((await voidIt(id).expect(201)).body).toMatchObject({ status: 'VOIDED', replay: false });

    expect(await inv(invId)).toMatchObject({ amountPaid: 0, remainingAmount: 400_000, status: 'OPEN', paidAt: null });
    const [row] = await db.select().from(payments).where(eq(payments.id, id));
    expect(row).toMatchObject({ status: 'VOIDED', voidReason: "Noto'g'ri o'quvchiga yozilgan" });
    expect(row.voidedAt).toBeTruthy();
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, id))).toHaveLength(0);
    const after = (await http().get(`/api/payments/finance-summary?forMonth=${month}`).set(bearer(owner)).expect(200)).body.totalRevenue as number;
    expect(after).toBe(before);
    const debt = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(bearer(owner)).expect(200)).body.debtors as Array<{ studentId: string; debtAmount: number }>;
    expect(debt.find((d) => d.studentId === s)?.debtAmount).toBe(400_000);
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, 'void')));
    expect(audit).toHaveLength(1);

    // Again: the same answer, nothing changes twice.
    expect((await voidIt(id).expect(201)).body).toMatchObject({ status: 'VOIDED', replay: true });
    expect(await inv(invId)).toMatchObject({ amountPaid: 0, remainingAmount: 400_000 });
  });

  it('a voided advance is not picked up by an invoice made later', async () => {
    const s = await student('Advance Kid');
    const id = await pay({ studentId: s, amount: 200_000 });
    await voidIt(id).expect(201);
    const invId = await invoice(s, 200_000);
    expect(await inv(invId)).toMatchObject({ amountPaid: 0, remainingAmount: 200_000 });
  });

  it('refused: a payment with a discount, and cash on a day whose cash is closed', async () => {
    const s = await student('Refused Kid');
    const invId = await invoice(s, 500_000);
    const discounted = await pay({ studentId: s, amount: 100_000, discount: 50_000, invoiceId: invId });
    expect((await voidIt(discounted).expect(409)).body.code).toBe('DISCOUNT');

    const cash = await pay({ studentId: s, amount: 70_000, method: 'CASH', invoiceId: invId, paidAt: '2026-10-15T07:00:00.000Z' });
    await http().post('/api/cash/day/close').set(bearer(owner)).send({ date: '2026-10-15', countedCash: 70_000 }).expect(201);
    expect((await voidIt(cash).expect(409)).body.code).toBe('CASH_DAY_CLOSED');
    expect((await db.select().from(payments).where(eq(payments.id, cash)))[0].status).toBe('PAID');
  });
});
