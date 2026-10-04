import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { expenses, salaryPayments } from '../src/db/schema.js';

// Paying teachers against real PostgreSQL: a month paid in parts, many
// clicks at once, retries and a failure in the middle never pay a month
// twice, and every payout is one expense - counted once in the totals.
describe('Payroll disbursement (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  let owner: string;
  let tenantId: string;
  let other: string;
  const auth = (t = owner) => ({ Authorization: `Bearer ${t}` });
  const month = '2031-05';

  // A FIXED teacher with no groups: the month's pay is the whole rate.
  const teacher = async (salaryValue: number, fullName = `Teacher ${Math.random()}`) =>
    (await http().post('/api/teachers').set(auth()).send({ fullName, salaryType: 'FIXED', salaryValue }).expect(201)).body.id as string;
  const disburse = (body: Record<string, unknown>, key?: string, token = owner) => {
    const r = http().post('/api/salary-payments/disburse').set(auth(token));
    if (key) r.set('Idempotency-Key', key);
    return r.send({ forMonth: month, paymentMethod: 'CASH', ...body });
  };
  const payoutsOf = (teacherId: string) => db.select().from(salaryPayments).where(eq(salaryPayments.teacherId, teacherId));
  const salaryExpenses = async () =>
    db.select().from(expenses).where(and(eq(expenses.tenantId, tenantId), eq(expenses.category, 'SALARY')));
  const line = async (teacherId: string, m = month) =>
    (await http().get(`/api/salary-payments/calculate?forMonth=${m}`).set(auth()).expect(200)).body.teachers.find((x: { teacherId: string }) => x.teacherId === teacherId);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const reg = async (tag: string) =>
      (await http().post('/api/auth/register')
        .send({ centerName: `Payroll ${tag} ${suffix}`, subdomain: `payroll-${tag}-${suffix}`, email: `payroll-${tag}-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
        .expect(201)).body;
    const a = await reg('a');
    owner = a.accessToken;
    tenantId = a.tenant.id;
    other = (await reg('b')).accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('pays a month in installments, each with its own linked expense', async () => {
    const t = await teacher(3_000_000);
    const first = (await disburse({ teacherId: t, amount: 1_000_000, notes: 'Avans' }).expect(201)).body;
    expect(first.salaryPayment).toMatchObject({ amount: 1_000_000, forMonth: month, expenseId: first.expense.id, paymentMethod: 'CASH' });
    expect(first.salaryPayment).not.toHaveProperty('idempotencyKey');
    expect(first.expense).toMatchObject({ category: 'SALARY', amount: 1_000_000 });
    expect(await line(t)).toMatchObject({ calculatedSalary: 3_000_000, paidAmount: 1_000_000, netPayable: 2_000_000, installments: 1, isPaid: false });

    await disburse({ teacherId: t, amount: 2_000_000, paymentMethod: 'BANK_TRANSFER' }).expect(201);
    expect(await line(t)).toMatchObject({ paidAmount: 3_000_000, netPayable: 0, installments: 2, isPaid: true });

    // Nothing left to pay: a third payout is refused and leaves nothing behind.
    await disburse({ teacherId: t, amount: 1 }).expect(400);
    const rows = await payoutsOf(t);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.expenseId)).size).toBe(2);

    const list = (await http().get(`/api/salary-payments?teacherId=${t}&forMonth=${month}`).set(auth()).expect(200)).body;
    expect(list.map((r: { amount: number }) => r.amount).sort()).toEqual([1_000_000, 2_000_000]);
  });

  it('ten clicks at once never pay past the month', async () => {
    const t = await teacher(500_000);
    const results = await Promise.all(Array.from({ length: 10 }, () => disburse({ teacherId: t, amount: 100_000 })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    const rows = await payoutsOf(t);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe(500_000);
    const linked = (await salaryExpenses()).filter((e) => rows.some((r) => r.expenseId === e.id));
    expect(linked).toHaveLength(5); // the refused ones wrote no expense
  });

  it('a retried request returns the first payout; the same key for another payout is a conflict', async () => {
    const t = await teacher(900_000);
    const key = `payroll-retry-${suffix}`;
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => disburse({ teacherId: t, amount: 300_000 }, key)));
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect(new Set([a, b, c].map((r) => r.body.salaryPayment.id)).size).toBe(1);
    expect(new Set([a, b, c].map((r) => r.body.expense.id)).size).toBe(1);
    expect(await payoutsOf(t)).toHaveLength(1);

    await disburse({ teacherId: t, amount: 200_000 }, key).expect(409);
    // Keys belong to a center: another center's payout with the same key is its own.
    const otherTeacher = (await http().post('/api/teachers').set(auth(other)).send({ fullName: 'Other', salaryType: 'FIXED', salaryValue: 100_000 }).expect(201)).body.id;
    await disburse({ teacherId: otherTeacher, amount: 100_000 }, key, other).expect(201);
    expect(await payoutsOf(t)).toHaveLength(1);
  });

  it('a failure in the middle leaves no payout and no expense; the key is not used up', async () => {
    const t = await teacher(400_000);
    const before = (await salaryExpenses()).length;
    const fn = `fail_salary_${suffix}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'payout refused (test)'; END $$ LANGUAGE plpgsql`));
    await db.execute(sql.raw(`CREATE TRIGGER ${fn} BEFORE INSERT ON salary_payments FOR EACH ROW WHEN (NEW.tenant_id = '${tenantId}') EXECUTE FUNCTION ${fn}()`));
    try {
      await disburse({ teacherId: t, amount: 400_000 }, `payroll-broken-${suffix}`).expect(500);
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER ${fn} ON salary_payments`));
      await db.execute(sql.raw(`DROP FUNCTION ${fn}()`));
    }
    expect(await payoutsOf(t)).toHaveLength(0);
    expect((await salaryExpenses()).length).toBe(before); // the expense written first was rolled back
    await disburse({ teacherId: t, amount: 400_000 }, `payroll-broken-${suffix}`).expect(201);
  });

  it('a payout expense is counted once in the totals and is changed only through payroll', async () => {
    const m = '2031-06';
    const t = await teacher(700_000);
    const { expense } = (await disburse({ teacherId: t, amount: 700_000, forMonth: m, paidAt: '2031-06-20T10:00:00.000Z' }).expect(201)).body;
    const summary = (await http().get(`/api/payments/finance-summary?forMonth=${m}`).set(auth()).expect(200)).body;
    expect(summary.totalExpenses).toBe(700_000);
    expect(summary.expensesByCategory.SALARY).toBe(700_000);

    await http().delete(`/api/expenses/${expense.id}`).set(auth()).expect(409);
    await http().patch(`/api/expenses/${expense.id}`).set(auth()).send({ amount: 1 }).expect(409);
    await http().patch(`/api/expenses/${expense.id}`).set(auth()).send({ notes: 'Naqd, kassadan' }).expect(200);
  });

  it('validates the month, the amount and the teacher', async () => {
    const t = await teacher(100_000);
    await disburse({ teacherId: t, amount: 1, forMonth: '2031-13' }).expect(400);
    await disburse({ teacherId: t, amount: 0 }).expect(400);
    await disburse({ teacherId: t, amount: 100_001 }).expect(400);
    await disburse({ teacherId: t, amount: 1 }, 'short').expect(400);
    await disburse({ teacherId: t, amount: 1 }, undefined, other).expect(404); // another center's teacher
    expect(await payoutsOf(t)).toHaveLength(0);
  });

  it('reports older salary records against their expenses without changing anything', async () => {
    const m = '2031-07';
    const twice = await teacher(1_000_000, `Twice ${suffix}`);
    const overwritten = await teacher(1_000_000, `Overwritten ${suffix}`);
    const bare = await teacher(1_000_000, `Bare ${suffix}`);
    // What the code before 0035 left behind: one row per month, no link.
    await db.insert(salaryPayments).values([
      { tenantId, teacherId: twice, amount: 600_000, forMonth: m },
      { tenantId, teacherId: overwritten, amount: 300_000, forMonth: m },
      { tenantId, teacherId: bare, amount: 1_000_000, forMonth: m },
    ]);
    const title = (name: string) => `O'qituvchi maoshi: ${name} (${m})`;
    await db.insert(expenses).values([
      { tenantId, title: title(`Twice ${suffix}`), category: 'SALARY', amount: 600_000, date: `${m}-25` },
      { tenantId, title: title(`Overwritten ${suffix}`), category: 'SALARY', amount: 500_000, date: `${m}-10` },
      { tenantId, title: title(`Overwritten ${suffix}`), category: 'SALARY', amount: 300_000, date: `${m}-25` },
      { tenantId, title: 'Bonus (qo\'lda)', category: 'SALARY', amount: 50_000, date: `${m}-28` },
    ]);
    const before = JSON.stringify(await db.select().from(salaryPayments).where(eq(salaryPayments.forMonth, m)).orderBy(salaryPayments.id));

    const r = (await http().get(`/api/salary-payments/reconciliation?forMonth=${m}`).set(auth()).expect(200)).body;
    const of = (id: string) => r.items.find((i: { teacherId: string }) => i.teacherId === id);
    expect(of(twice)).toMatchObject({ status: 'LIKELY_DOUBLE_COUNTED', recordedAmount: 600_000, matchedExpenseTotal: 600_000 });
    expect(of(overwritten)).toMatchObject({ status: 'AMOUNT_MISMATCH', recordedAmount: 300_000, matchedExpenseTotal: 800_000, difference: 500_000 });
    expect(of(bare)).toMatchObject({ status: 'NO_EXPENSE', matchedExpenseTotal: 0 });
    expect(r.expensesWithoutPayroll.map((e: { amount: number }) => e.amount)).toEqual([50_000]);
    expect(r.totals).toMatchObject({ legacyRows: 3, likelyDoubleCounted: 600_000, mismatched: 1, withoutExpense: 1, expensesWithoutPayroll: 50_000 });

    // Read-only, and the old rows still count in payroll as they did.
    expect(JSON.stringify(await db.select().from(salaryPayments).where(eq(salaryPayments.forMonth, m)).orderBy(salaryPayments.id))).toBe(before);
    expect(await line(overwritten, m)).toMatchObject({ paidAmount: 300_000, installments: 1 });
    // Another center sees none of it.
    const foreign = (await http().get(`/api/salary-payments/reconciliation?forMonth=${m}`).set(auth(other)).expect(200)).body;
    expect(foreign.items).toEqual([]);
    await http().get('/api/salary-payments/reconciliation?forMonth=bad').set(auth()).expect(400);
  });
});
