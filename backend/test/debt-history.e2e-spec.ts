import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { enrollments, groupPriceHistory, groups, invoices, paymentAllocations, payments, students, tenants } from '../src/db/schema.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';

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

  describe('a past month whose price was never recorded', () => {
    // A group from before prices were versioned: it cost 400 000 then and
    // costs 600 000 now. Migration 0030 left one row - today's price, dated
    // back to the group's creation - which 0033 labels ASSUMED.
    let legacy: string;
    let solid: string;
    let kid: string;
    let both: string;
    const legacyGroup = async (name: string, price: number, since: string) => {
      const id = await newGroup(name, price, since);
      await db.update(groupPriceHistory).set({ source: 'ASSUMED', effectiveFrom: mid(since), createdAt: new Date() }).where(eq(groupPriceHistory.groupId, id));
      return id;
    };

    it('is shown as an unverified estimate, never as debt', async () => {
      legacy = await legacyGroup('Legacy Price G', 600_000, m3);
      solid = await newGroup('Recorded Price G', 250_000, m3);
      kid = await newStudent('Old Price Kid', [legacy], m3);
      both = await newStudent('Mixed Kid', [legacy, solid], m3);

      const before = await debtors(m2);
      const row = before.debtors.find((d: { studentId: string }) => d.studentId === kid);
      // Not "owes 600 000": nothing on record says what that month cost.
      expect(row).toMatchObject({ expectedAmount: 0, debtAmount: 0, unverifiedAmount: 600_000, unverifiedDebt: 600_000, status: 'UNVERIFIED' });
      expect(row.groups).toEqual([expect.objectContaining({ name: 'Legacy Price G', monthlyPrice: 600_000, verified: false })]);
      // Mixed: the recorded group is debt, the other one stays an estimate.
      expect(before.debtors.find((d: { studentId: string }) => d.studentId === both))
        .toMatchObject({ expectedAmount: 250_000, debtAmount: 250_000, unverifiedDebt: 600_000, status: 'UNPAID', estimated: true });
      expect(before.unverifiedGroups).toContainEqual({ id: legacy, name: 'Legacy Price G', assumedPrice: 600_000 });
      expect(before.unverifiedCount).toBeGreaterThanOrEqual(2);

      // The totals are the recorded debt only; the estimate has its own line.
      expect(before.totalDebt).toBe(before.debtors.reduce((s: number, d: { debtAmount: number }) => s + d.debtAmount, 0));
      expect(before.totalUnverifiedDebt).toBe(before.debtors.reduce((s: number, d: { unverifiedDebt: number }) => s + d.unverifiedDebt, 0));
      expect(before.debtorCount).toBe(before.debtors.filter((d: { debtAmount: number }) => d.debtAmount > 0).length);

      // From the month the price is on record (now), it is ordinary debt.
      expect(await of(current, kid)).toMatchObject({ expectedAmount: 600_000, debtAmount: 600_000, unverifiedDebt: 0, status: 'UNPAID' });
    });

    it('summary, director report and reminders treat it the same way', async () => {
      const list = await debtors(m2);
      const fin = (await http().get(`/api/payments/finance-summary?forMonth=${m2}`).set(auth()).expect(200)).body;
      expect(fin.totalOutstandingDebt).toBe(list.totalDebt);
      expect(fin.unverifiedDebt).toBe(list.totalUnverifiedDebt);
      const dir = (await http().get(`/api/reports/director?month=${m2}`).set(auth()).expect(200)).body;
      const row = dir.trend.find((t: { month: string }) => t.month === m2);
      expect(row.debt).toBe(list.totalDebt);
      expect(row.unverifiedDebt).toBe(list.totalUnverifiedDebt);
      expect(dir.debtors.items.find((d: { studentId: string }) => d.studentId === kid)).toBeUndefined(); // not a debtor on record

      // Nobody is asked to pay an estimate.
      const notifications = app.get(NotificationsService);
      const sent: Array<{ studentId?: string }> = [];
      const send = vi.spyOn(notifications, 'send').mockImplementation((async (_t: string, m: { studentId?: string }) => { sent.push(m); }) as never);
      await db.update(students).set({ telegramChatId: `8${String(suffix).slice(-8)}` }).where(eq(students.id, kid));
      await db.update(students).set({ telegramChatId: `7${String(suffix).slice(-8)}` }).where(eq(students.id, both));
      const res = await notifications.notifyDebtors(tenantId, m2, [kid, both]);
      send.mockRestore();
      expect(res.processedDebtors).toBe(1);
      expect([...new Set(sent.map((x) => x.studentId))]).toEqual([both]);
    });

    it('an invoice run for that month does not turn the estimate into an invoice', async () => {
      const gen = (await http().post('/api/invoices/generate-monthly').set(auth()).send({ forMonth: m2 }).expect(201)).body;
      expect(gen.skippedUnverified).toContainEqual({ groupId: legacy, groupName: 'Legacy Price G', students: 2 });
      const mine = gen.invoices.filter((i: { studentId: string }) => [kid, both].includes(i.studentId));
      // Only the group with a recorded price was invoiced.
      expect(mine.map((i: { studentId: string; amount: number }) => [i.studentId, i.amount])).toEqual([[both, 250_000]]);
      expect(await of(m2, kid)).toMatchObject({ debtAmount: 0, unverifiedDebt: 600_000, status: 'UNVERIFIED' });
    });

    it('an authorized person confirms what it cost; the month becomes recorded debt at that price', async () => {
      // Front desk may neither confirm nor see money history.
      const email = `debt-rec-${suffix}@test.uz`;
      await http().post('/api/staff').set(auth()).send({ fullName: 'Front Desk', email, password: 'password123', role: 'RECEPTIONIST' }).expect(201);
      const desk = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
      await http().post(`/api/groups/${legacy}/price-history`).set({ Authorization: `Bearer ${desk}` }).send({ month: m3, monthlyPrice: 400_000 }).expect(403);
      await http().post(`/api/groups/${legacy}/price-history`).set(auth()).send({ month: '2026-13', monthlyPrice: 400_000 }).expect(400);
      await http().post(`/api/groups/${legacy}/price-history`).set(auth()).send({ month: shift(current, 1), monthlyPrice: 400_000 }).expect(400);

      const history = (await http().post(`/api/groups/${legacy}/price-history`).set(auth())
        .send({ month: m3, monthlyPrice: 400_000, note: 'Old price list' }).expect(201)).body;
      expect(history.map((h: { monthlyPrice: number; source: string }) => [h.monthlyPrice, h.source]).sort()).toEqual([[400_000, 'RECORDED'], [600_000, 'ASSUMED']]);
      expect(history.find((h: { source: string }) => h.source === 'RECORDED')).toMatchObject({ note: 'Old price list', confirmedByUserId: expect.any(String) });

      // The old months at the confirmed price; today's price untouched.
      expect(await of(m2, kid)).toMatchObject({ expectedAmount: 400_000, debtAmount: 400_000, unverifiedDebt: 0, status: 'UNPAID', estimated: true });
      expect(await of(m2, both)).toMatchObject({ expectedAmount: 650_000, debtAmount: 650_000, unverifiedDebt: 0 });
      expect(await of(current, kid)).toMatchObject({ expectedAmount: 600_000, debtAmount: 600_000 });
      expect((await http().get(`/api/groups/${legacy}`).set(auth()).expect(200)).body.monthlyPrice).toBe(600_000);
      expect((await debtors(m2)).unverifiedGroups.map((g: { id: string }) => g.id)).not.toContain(legacy);

      // And now an invoice may be issued for it - at 400 000, not 600 000.
      const gen = (await http().post('/api/invoices/generate-monthly').set(auth()).send({ forMonth: m2 }).expect(201)).body;
      expect(gen.invoices.find((i: { studentId: string }) => i.studentId === kid)).toMatchObject({ amount: 400_000 });
      expect(await of(m2, kid)).toMatchObject({ expectedAmount: 400_000, debtAmount: 400_000, estimated: false });

      // A correction is a new entry; the earlier ones stay in the history.
      const fixed = (await http().post(`/api/groups/${legacy}/price-history`).set(auth()).send({ month: m3, monthlyPrice: 450_000 }).expect(201)).body;
      expect(fixed).toHaveLength(3);
      expect(await of(m3, kid)).toMatchObject({ expectedAmount: 450_000 });
      // ...and it does not rewrite the invoice already issued for m2.
      expect(await of(m2, kid)).toMatchObject({ expectedAmount: 400_000, debtAmount: 400_000 });

      // The confirmation is in the audit log.
      let logged = false;
      for (let i = 0; i < 20 && !logged; i++) {
        const logs = (await http().get('/api/audit-logs?entityType=group_price').set(auth()).expect(200)).body;
        logged = JSON.stringify(logs).includes('Old price list');
        if (!logged) await new Promise((r) => setTimeout(r, 100));
      }
      expect(logged).toBe(true);
    });
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
