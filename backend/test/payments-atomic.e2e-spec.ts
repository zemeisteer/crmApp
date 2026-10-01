import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { billingTransactions, invoices, paymentAllocations, payments } from '../src/db/schema.js';
import { BillingService } from '../src/billing/billing.service.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { WebhooksService } from '../src/webhooks/webhooks.service.js';

// Payments taken by staff against real PostgreSQL: many requests at once,
// retries, and failures in the middle must never lose or double money.
describe('Atomic, retry-safe manual payments (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let tenantId: string;
  let other: string;
  const auth = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const month = '2026-03';
  const due = '2026-03-10T12:00:00.000Z';
  let notified: ReturnType<typeof vi.spyOn>;
  let webhooked: ReturnType<typeof vi.spyOn>;

  const group = async (price: number, name = `G ${Math.random()}`) =>
    (await http().post('/api/groups').set(auth()).send({ name, subject: 'Math', monthlyPrice: price }).expect(201)).body.id as string;
  const student = async (groupIds: string[] = []) =>
    (await http().post('/api/students').set(auth()).send({ fullName: `Kid ${Math.random()}`, groupIds }).expect(201)).body.id as string;
  const invoice = async (studentId: string, amount: number, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/invoices').set(auth()).send({ studentId, amount, dueDate: due, forMonth: month, ...extra }).expect(201)).body;
  const pay = (body: Record<string, unknown>, token = owner) =>
    http().post('/api/payments').set(auth(token)).send({ forMonth: month, method: 'CASH', ...body });
  const invoiceRow = async (id: string) => (await db.select().from(invoices).where(eq(invoices.id, id)))[0];
  const paymentsOf = (studentId: string) => db.select().from(payments).where(eq(payments.studentId, studentId));
  const allocated = async (invoiceId: string) =>
    (await db.select({ total: sql<number>`coalesce(sum(${paymentAllocations.amount}), 0)::int` }).from(paymentAllocations).where(eq(paymentAllocations.invoiceId, invoiceId)))[0].total;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = async (tag: string) =>
      (await http().post('/api/auth/register')
        .send({ centerName: `Pay ${tag} ${suffix}`, subdomain: `pay-${tag}-${suffix}`, email: `pay-${tag}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
        .expect(201)).body;
    const a = await reg('a');
    owner = a.accessToken;
    tenantId = a.tenant.id;
    other = (await reg('b')).accessToken;
    notified = vi.spyOn(app.get(NotificationsService), 'notifyPaymentReceived').mockResolvedValue(undefined);
    webhooked = vi.spyOn(app.get(WebhooksService), 'dispatch').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('ten cashiers at once never pay an invoice past its balance', async () => {
    const kid = await student();
    const inv = await invoice(kid, 500_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => pay({ studentId: kid, invoiceId: inv.id, amount: 100_000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);

    const row = await invoiceRow(inv.id);
    expect(row).toMatchObject({ amountPaid: 500_000, remainingAmount: 0, status: 'PAID' });
    expect(await allocated(inv.id)).toBe(500_000);
    expect(await paymentsOf(kid)).toHaveLength(5); // the refused ones left nothing behind
  });

  it('a retried request returns the first payment and sends nothing twice', async () => {
    const kid = await student();
    const inv = await invoice(kid, 300_000);
    const key = `retry-${suffix}-1`;
    notified.mockClear();
    webhooked.mockClear();

    const burst = await Promise.all(Array.from({ length: 8 }, () => pay({ studentId: kid, amount: 100_000, idempotencyKey: key })));
    expect(burst.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(burst.map((r) => r.body.id)).size).toBe(1);
    expect(burst[0].body).not.toHaveProperty('idempotencyKey');
    expect(burst[0].body).not.toHaveProperty('requestHash');

    // Later retries too, by body field or by header.
    const again = await pay({ studentId: kid, amount: 100_000, idempotencyKey: key }).expect(201);
    const byHeader = await pay({ studentId: kid, amount: 100_000 }).set('Idempotency-Key', key).expect(201);
    expect(again.body.id).toBe(burst[0].body.id);
    expect(byHeader.body.id).toBe(burst[0].body.id);

    expect(await paymentsOf(kid)).toHaveLength(1);
    expect(await invoiceRow(inv.id)).toMatchObject({ amountPaid: 100_000, remainingAmount: 200_000, status: 'PARTIALLY_PAID' });
    expect(notified).toHaveBeenCalledTimes(1);
    expect(webhooked.mock.calls.filter((c: unknown[]) => c[1] === 'payment.created')).toHaveLength(1);

    // The key belongs to that request: other contents are refused, not merged.
    await pay({ studentId: kid, amount: 150_000, idempotencyKey: key }).expect(409);
    const someoneElse = await student();
    await pay({ studentId: someoneElse, amount: 100_000, idempotencyKey: key }).expect(409);
    expect(await paymentsOf(someoneElse)).toHaveLength(0);
    await pay({ studentId: kid, amount: 1, idempotencyKey: 'short' }).expect(400);

    // Keys are per center: another center may use the same value.
    const theirs = (await http().post('/api/students').set(auth(other)).send({ fullName: 'Other Kid' }).expect(201)).body.id;
    await pay({ studentId: theirs, amount: 100_000, idempotencyKey: key }, other).expect(201);
    // Without a key every request is a new payment, as before.
    await pay({ studentId: kid, amount: 50_000 }).expect(201);
    await pay({ studentId: kid, amount: 50_000 }).expect(201);
    expect(await paymentsOf(kid)).toHaveLength(3);
  });

  it('a failure in the middle leaves no payment, no allocation and no message', async () => {
    const kid = await student();
    const inv = await invoice(kid, 200_000);
    notified.mockClear();
    webhooked.mockClear();
    // Break the allocation step for this center only.
    const fn = `fail_alloc_${suffix}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'allocation refused (test)'; END $$ LANGUAGE plpgsql`));
    await db.execute(sql.raw(`CREATE TRIGGER ${fn} BEFORE INSERT ON payment_allocations FOR EACH ROW WHEN (NEW.tenant_id = '${tenantId}') EXECUTE FUNCTION ${fn}()`));
    try {
      await pay({ studentId: kid, amount: 200_000, idempotencyKey: `broken-${suffix}` }).expect(500);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER ${fn} ON payment_allocations`));
      await db.execute(sql.raw(`DROP FUNCTION ${fn}()`));
    }
    expect(await paymentsOf(kid)).toHaveLength(0);
    expect(await invoiceRow(inv.id)).toMatchObject({ amountPaid: 0, remainingAmount: 200_000, status: 'OPEN' });
    expect(notified).not.toHaveBeenCalled();
    expect(webhooked).not.toHaveBeenCalled();

    // The same key works once the fault is gone: the failed attempt did not use it up.
    await pay({ studentId: kid, amount: 200_000, idempotencyKey: `broken-${suffix}` }).expect(201);
    expect(await invoiceRow(inv.id)).toMatchObject({ amountPaid: 200_000, remainingAmount: 0, status: 'PAID' });
  });

  it('validates the invoice, the discount and the month the same way every time', async () => {
    const kid = await student();
    const inv = await invoice(kid, 400_000);
    await pay({ studentId: kid, invoiceId: inv.id, amount: 400_001 }).expect(400); // overpayment
    await pay({ studentId: kid, invoiceId: inv.id, amount: 390_000, discount: 20_000 }).expect(400); // with discount, too
    await pay({ studentId: kid, invoiceId: inv.id, amount: 100_000, forMonth: '2026-04' }).expect(400); // other month
    await pay({ studentId: kid, amount: 0 }).expect(400);
    await pay({ studentId: kid, amount: 1000, forMonth: '2026-13' }).expect(400);
    await pay({ studentId: kid, amount: 1000, paidAt: 'yesterday' }).expect(400);
    await pay({ studentId: 'nobody', amount: 1000 }).expect(404);
    await pay({ studentId: kid, invoiceId: 'nothing', amount: 1000 }).expect(404);
    expect(await paymentsOf(kid)).toHaveLength(0);

    // A payment that has not been received yet settles nothing.
    await pay({ studentId: kid, invoiceId: inv.id, amount: 100_000, status: 'PENDING' }).expect(201);
    expect(await invoiceRow(inv.id)).toMatchObject({ amountPaid: 0, remainingAmount: 400_000 });

    // Money plus discount exactly closes it.
    await pay({ studentId: kid, invoiceId: inv.id, amount: 380_000, discount: 20_000 }).expect(201);
    expect(await invoiceRow(inv.id)).toMatchObject({ amountPaid: 380_000, remainingAmount: 0, status: 'PAID' });
    await pay({ studentId: kid, invoiceId: inv.id, amount: 1 }).expect(400); // nothing left

    const cancelled = await invoice(kid, 100_000);
    await http().post(`/api/invoices/${cancelled.id}/cancel`).set(auth()).expect(201);
    await pay({ studentId: kid, invoiceId: cancelled.id, amount: 100_000 }).expect(400);
    // A paid invoice cannot be cancelled.
    await http().post(`/api/invoices/${inv.id}/cancel`).set(auth()).expect(400);
  });

  it('with several invoices in a month, money goes to the oldest due first, then the next', async () => {
    const g1 = await group(300_000, 'Late');
    const g2 = await group(200_000, 'Early');
    const kid = await student([g1, g2]);
    const enr = (await http().get(`/api/students/${kid}`).set(auth()).expect(200)).body.enrollments as Array<{ id: string; groupId: string }>;
    const late = await invoice(kid, 300_000, { enrollmentId: enr.find((e) => e.groupId === g1)!.id, dueDate: '2026-03-20T12:00:00.000Z' });
    const early = await invoice(kid, 200_000, { enrollmentId: enr.find((e) => e.groupId === g2)!.id, dueDate: '2026-03-05T12:00:00.000Z' });
    const skipped = await invoice(kid, 900_000, { dueDate: '2026-03-01T12:00:00.000Z' });
    await http().post(`/api/invoices/${skipped.id}/cancel`).set(auth()).expect(201);

    // 250 000 with no invoice named: 200 000 closes "Early", 50 000 starts "Late".
    const p = (await pay({ studentId: kid, amount: 250_000 }).expect(201)).body;
    expect(p.invoiceId).toBe(early.id);
    expect(p.allocations.map((a: { invoiceId: string; amount: number }) => [a.invoiceId, a.amount]).sort()).toEqual([[early.id, 200_000], [late.id, 50_000]].sort());
    expect(await invoiceRow(early.id)).toMatchObject({ remainingAmount: 0, status: 'PAID' });
    expect(await invoiceRow(late.id)).toMatchObject({ amountPaid: 50_000, remainingAmount: 250_000, status: 'PARTIALLY_PAID' });
    expect(await invoiceRow(skipped.id)).toMatchObject({ amountPaid: 0, status: 'CANCELLED' });

    // More than the month needs: the invoices are closed, the rest stays on
    // the payment as an advance and the month shows no debt.
    await pay({ studentId: kid, amount: 300_000 }).expect(201);
    expect(await invoiceRow(late.id)).toMatchObject({ amountPaid: 300_000, remainingAmount: 0, status: 'PAID' });
    const debt = (await http().get(`/api/payments/debtors?forMonth=${month}`).set(auth()).expect(200)).body;
    expect(debt.debtors.find((d: { studentId: string }) => d.studentId === kid)).toMatchObject({ expectedAmount: 500_000, paidAmount: 550_000, debtAmount: 0, status: 'PAID' });
  });

  it('a payment and the monthly invoice run meeting at the same moment agree afterwards', async () => {
    const g = await group(120_000, 'Race');
    const kids = await Promise.all(Array.from({ length: 6 }, () => student([g])));
    const [gen] = await Promise.all([
      http().post('/api/invoices/generate-monthly').set(auth()).send({ forMonth: month }),
      ...kids.map((k) => pay({ studentId: k, amount: 120_000 }).expect(201)),
      http().post('/api/invoices/generate-monthly').set(auth()).send({ forMonth: month }),
    ]);
    expect(gen.status).toBe(201);
    for (const k of kids) {
      const inv = await db.select().from(invoices).where(and(eq(invoices.studentId, k), eq(invoices.forMonth, month)));
      expect(inv).toHaveLength(1); // two runs at once issue it once
      expect(inv[0]).toMatchObject({ amountPaid: 120_000, remainingAmount: 0, status: 'PAID' });
      expect(await allocated(inv[0].id)).toBe(120_000);
      expect(await paymentsOf(k)).toHaveLength(1);
    }
  });

  it('a gateway payment and a desk payment for the same invoice do not both take the balance', async () => {
    const kid = await student();
    const inv = await invoice(kid, 150_000);
    const [tx] = await db.insert(billingTransactions)
      .values({ tenantId, studentId: kid, invoiceId: inv.id, provider: 'CLICK', amount: 150_000, forMonth: month, status: 'CREATED' })
      .returning();
    const billing = app.get(BillingService);
    const [, , desk] = await Promise.all([
      billing.finalizePayment(tx.id, `click-${suffix}`),
      billing.finalizePayment(tx.id, `click-${suffix}`), // the provider retrying its callback
      pay({ studentId: kid, invoiceId: inv.id, amount: 150_000 }),
    ]);
    const row = await invoiceRow(inv.id);
    expect(row).toMatchObject({ remainingAmount: 0, status: 'PAID', amountPaid: 150_000 });
    expect(await allocated(inv.id)).toBe(150_000);
    const rows = await paymentsOf(kid);
    expect(rows.filter((p) => p.method === 'CLICK')).toHaveLength(1); // the gateway payment is always recorded
    // The desk payment either came first (and the online money is kept as an
    // unallocated advance) or was refused; it never double-fills the invoice.
    expect([201, 400]).toContain(desk.status);
    expect(rows).toHaveLength(desk.status === 201 ? 2 : 1);
    const [done] = await db.select().from(billingTransactions).where(eq(billingTransactions.id, tx.id));
    expect(done.status).toBe('PAID');
    expect(done.paymentId).toBe(rows.find((p) => p.method === 'CLICK')!.id);
  });
});
