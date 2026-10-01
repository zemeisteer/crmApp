import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { enrollments, groupPriceHistory, groups, invoices, paymentAllocations, payments, students, tenants } from '../src/db/schema.js';

// What was owed for a past month must not change because of what happened
// later: a price rise, a pause, a student leaving or being removed.
describe('Historical debt (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let tenantId: string;
  const auth = () => ({ Authorization: `Bearer ${owner}` });

  // Months relative to now in the center's zone, so the suite never ages.
  const tzMonth = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
  const now = new Date();
  const current = tzMonth(now);
  const shift = (m: string, by: number) => {
    const [y, mm] = m.split('-').map(Number);
    const d = new Date(Date.UTC(y, mm - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const m1 = shift(current, -1);
  const m2 = shift(current, -2);
  const m3 = shift(current, -3);
  const mid = (m: string) => new Date(`${m}-15T07:00:00.000Z`);

  const debtors = async (month: string) => (await http().get(`/api/payments/debtors?forMonth=${month}`).set(auth()).expect(200)).body;
  const of = async (month: string, studentId: string) => (await debtors(month)).debtors.find((d: { studentId: string }) => d.studentId === studentId);
  const newGroup = async (name: string, price: number, since: string) => {
    const id = (await http().post('/api/groups').set(auth()).send({ name, subject: 'Math', monthlyPrice: price }).expect(201)).body.id as string;
    // The group has existed (at this price) since `since`.
    await db.update(groups).set({ createdAt: mid(since) }).where(eq(groups.id, id));
    await db.update(groupPriceHistory).set({ effectiveFrom: mid(since) }).where(eq(groupPriceHistory.groupId, id));
    return id;
  };
  const newStudent = async (name: string, groupIds: string[], since: string) => {
    const id = (await http().post('/api/students').set(auth()).send({ fullName: name, groupIds }).expect(201)).body.id as string;
    await db.update(students).set({ createdAt: mid(since) }).where(eq(students.id, id));
    await db.update(enrollments).set({ joinedAt: mid(since) }).where(eq(enrollments.studentId, id));
    return id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Debt ${suffix}`, subdomain: `debt-${suffix}`, email: `debt-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body;
    owner = reg.accessToken;
    tenantId = reg.tenant.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a price change applies from its month on; earlier months keep the old price', async () => {
    const g = await newGroup('Price G', 400_000, m3);
    const kid = await newStudent('Price Kid', [g], m3);
    await http().patch(`/api/groups/${g}`).set(auth()).send({ monthlyPrice: 600_000 }).expect(200);

    expect(await of(m2, kid)).toMatchObject({ expectedAmount: 400_000, debtAmount: 400_000, estimated: true });
    expect(await of(current, kid)).toMatchObject({ expectedAmount: 600_000, debtAmount: 600_000 });
    expect((await of(m2, kid)).groups).toEqual([expect.objectContaining({ name: 'Price G', monthlyPrice: 400_000 })]);
    // Saving the group again without a new price adds no history.
    await http().patch(`/api/groups/${g}`).set(auth()).send({ monthlyPrice: 600_000 }).expect(200);
    expect(await db.select().from(groupPriceHistory).where(eq(groupPriceHistory.groupId, g))).toHaveLength(2);
  });

  it('paused, left and removed students keep what they owed before', async () => {
    const g = await newGroup('Status G', 300_000, m3);
    const paused = await newStudent('Paused Kid', [g], m3);
    const left = await newStudent('Left Kid', [g], m3);
    const removed = await newStudent('Removed Kid', [g], m3);
    const stays = await newStudent('Staying Kid', [g], m3);
    await http().post('/api/payments').set(auth()).send({ studentId: left, amount: 100_000, forMonth: m1, method: 'CASH' }).expect(201);

    const before = await debtors(m1);
    expect(before.totalDebt).toBeGreaterThanOrEqual(1_100_000);

    await http().patch(`/api/students/${paused}`).set(auth()).send({ status: 'PAUSED' }).expect(200);
    await http().patch(`/api/students/${left}`).set(auth()).send({ status: 'LEFT', leftReason: 'PRICE' }).expect(200);
    await http().delete(`/api/students/${removed}`).set(auth()).expect(200);

    // Last month: exactly as before.
    const after = await debtors(m1);
    expect(after.totalDebt).toBe(before.totalDebt);
    expect(after.debtorCount).toBe(before.debtorCount);
    expect(await of(m1, paused)).toMatchObject({ debtAmount: 300_000, studentStatus: 'PAUSED', status: 'UNPAID' });
    expect(await of(m1, left)).toMatchObject({ paidAmount: 100_000, debtAmount: 200_000, studentStatus: 'LEFT', status: 'PARTIAL' });
    expect(await of(m1, removed)).toMatchObject({ debtAmount: 300_000, studentStatus: 'REMOVED' });

    // This month: they stopped, so nothing new is charged.
    for (const id of [paused, left, removed]) expect(await of(current, id)).toBeUndefined();
    expect(await of(current, stays)).toMatchObject({ debtAmount: 300_000 });

    // Coming back from a pause charges again from now, and the past stays.
    await http().patch(`/api/students/${paused}`).set(auth()).send({ status: 'ACTIVE' }).expect(200);
    expect(await of(current, paused)).toMatchObject({ debtAmount: 300_000 });
    expect(await of(m1, paused)).toMatchObject({ debtAmount: 300_000 });
  });

  it('an invoice fixes the month: later price and status changes do not rewrite it', async () => {
    const a = await newGroup('Inv A', 500_000, m3);
    const b = await newGroup('Inv B', 200_000, m3);
    const kid = await newStudent('Two Groups', [a, b], m3);
    const gen = (await http().post('/api/invoices/generate-monthly').set(auth()).send({ forMonth: m1 }).expect(201)).body;
    expect(gen.invoices.filter((i: { studentId: string }) => i.studentId === kid)).toHaveLength(2);
    // One payment for the month: the two invoices are filled in order.
    await http().post('/api/payments').set(auth()).send({ studentId: kid, amount: 600_000, forMonth: m1, method: 'CASH' }).expect(201);
    expect(await of(m1, kid)).toMatchObject({ expectedAmount: 700_000, paidAmount: 600_000, debtAmount: 100_000, estimated: false, status: 'PARTIAL' });

    await http().patch(`/api/groups/${a}`).set(auth()).send({ monthlyPrice: 900_000 }).expect(200);
    await http().delete(`/api/students/${kid}/enroll/${b}`).set(auth()).expect(200);
    await http().patch(`/api/students/${kid}`).set(auth()).send({ status: 'GRADUATED' }).expect(200);
    expect(await of(m1, kid)).toMatchObject({ expectedAmount: 700_000, paidAmount: 600_000, debtAmount: 100_000 });
    // m2 had no invoices: both groups at the prices of that time.
    expect(await of(m2, kid)).toMatchObject({ expectedAmount: 700_000, debtAmount: 700_000, estimated: true });
  });

  it('old payments that were never linked to an invoice still count, and nothing is rewritten', async () => {
    const g = await newGroup('Legacy G', 350_000, m3);
    const kid = await newStudent('Legacy Kid', [g], m3);
    // As data from before allocations looked: an invoice and a separate payment.
    const [inv] = await db.insert(invoices)
      .values({ tenantId, studentId: kid, amount: 350_000, amountPaid: 0, remainingAmount: 350_000, dueDate: mid(m2), forMonth: m2, status: 'OPEN' })
      .returning();
    const [old] = await db.insert(payments)
      .values({ tenantId, studentId: kid, amount: 250_000, discount: 50_000, forMonth: m2, status: 'PAID', method: 'CASH', paidAt: mid(m2) })
      .returning();

    expect(await of(m2, kid)).toMatchObject({ expectedAmount: 350_000, discountAmount: 50_000, paidAmount: 250_000, debtAmount: 50_000, status: 'PARTIAL' });
    // Reading is all that happened.
    expect((await db.select().from(invoices).where(eq(invoices.id, inv.id)))[0]).toMatchObject({ amountPaid: 0, remainingAmount: 350_000, status: 'OPEN' });
    expect(await db.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, old.id))).toHaveLength(0);
    expect((await db.select().from(payments).where(eq(payments.id, old.id)))[0]).toMatchObject({ invoiceId: null, amount: 250_000 });
  });

  it('the list, the finance summary, the dashboard and the director report show the same debt', async () => {
    for (const month of [m1, current]) {
      const list = await debtors(month);
      expect(list.debtors.reduce((s: number, d: { debtAmount: number }) => s + d.debtAmount, 0)).toBe(list.totalDebt);
      expect(list.debtors.filter((d: { debtAmount: number }) => d.debtAmount > 0)).toHaveLength(list.debtorCount);
      const only = (await http().get(`/api/payments/debtors?forMonth=${month}&onlyDebtors=true`).set(auth()).expect(200)).body;
      expect(only.debtors).toHaveLength(list.debtorCount);
      expect(only.totalDebt).toBe(list.totalDebt);

      const fin = (await http().get(`/api/payments/finance-summary?forMonth=${month}`).set(auth()).expect(200)).body;
      expect(fin.totalOutstandingDebt).toBe(list.totalDebt);
      expect(fin.debtorCount).toBe(list.debtorCount);
      expect(fin.totalExpectedRevenue).toBe(list.totalExpected);

      const dir = (await http().get(`/api/reports/director?month=${month}`).set(auth()).expect(200)).body;
      const row = dir.trend.find((t: { month: string }) => t.month === month);
      expect(row.debt).toBe(list.totalDebt);
      expect(row.expected).toBe(list.totalExpected);
      expect(dir.debtors.items.reduce((s: number, d: { currentMonthDebt: number }) => s + d.currentMonthDebt, 0)).toBe(list.totalDebt);
    }
    // Without a month: the current month at the center, not on the server.
    expect((await http().get('/api/payments/debtors').set(auth()).expect(200)).body.forMonth).toBe(current);
  });

  it("the month it is now follows the center's time zone", async () => {
    await db.update(tenants).set({ timezone: 'Pacific/Kiritimati' }).where(eq(tenants.id, tenantId)); // UTC+14
    const there = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Kiritimati', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
    expect((await http().get('/api/payments/debtors').set(auth()).expect(200)).body.forMonth).toBe(there);
    expect((await http().get('/api/payments/finance-summary').set(auth()).expect(200)).body.forMonth).toBe(there);
    await db.update(tenants).set({ timezone: 'Asia/Tashkent' }).where(eq(tenants.id, tenantId));
    await http().get('/api/payments/debtors?forMonth=2026-1').set(auth()).expect(400);
  });
});
