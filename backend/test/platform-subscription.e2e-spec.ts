import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { platformSubscriptions, tenants } from '../src/db/schema.js';
import { BillingLifecycleService } from '../src/platform-billing/billing-lifecycle.service.js';

// A center pays CRMAPP for a period, not once and forever: each payment adds
// a month to `paid_until` (counted from where the paid time ends, so paying
// early loses nothing); when it runs out the center is PAST_DUE for the
// grace days (still working), then suspended for non-payment until it pays
// (BILLING_ENFORCE, off by default). The providers' callbacks are a state
// machine: the amount is checked, one transaction per invoice, a retry does
// nothing twice, a cancel after payment takes the month back.
// Keys below are test values; no real payment is made.
describe('Platform subscription: periods, renewal, grace, providers (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let lifecycle: BillingLifecycleService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const DAY = 86_400_000;
  const ENV = {
    PLATFORM_CLICK_MERCHANT_ID: 'plat_click_merchant', PLATFORM_CLICK_SERVICE_ID: 'plat_click_service', PLATFORM_CLICK_SECRET_KEY: 'plat_click_secret',
    PLATFORM_PAYME_MERCHANT_ID: 'plat_payme_merchant', PLATFORM_PAYME_KEY: 'plat_payme_key', BILLING_ENFORCE: 'off', BILLING_GRACE_DAYS: '7',
  };
  const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));
  const payme = (method: string, params: Record<string, unknown>) =>
    http().post('/api/platform-billing/payme/webhook').set('Authorization', 'Basic ' + Buffer.from('Paycom:plat_payme_key').toString('base64')).send({ method, params, id: 1 });
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const click = (action: '0' | '1', subId: string, amount: number, transId: string, extra: Record<string, string> = {}) => {
    const sign_time = '2026-10-23 10:00:00';
    const prepare = action === '1' ? subId : '';
    const sign_string = md5(`${transId}plat_click_serviceplat_click_secret${subId}${prepare}${amount}${action}${sign_time}`);
    return http().post('/api/platform-billing/click/webhook').send({ click_trans_id: transId, service_id: 'plat_click_service', merchant_trans_id: subId, merchant_prepare_id: prepare, amount: String(amount), action, sign_time, sign_string, error: '0', ...extra });
  };
  let n = 0;
  const center = async () => {
    const key = `ps${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `PS ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    return { id: body.tenant.id as string, token: body.accessToken as string };
  };
  const tenant = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0];
  const invoice = async (id: string) => (await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id)))[0];
  const link = (c: { token: string }, forMonth: string, provider: 'payme' | 'click' = 'payme') =>
    http().post(`/api/platform-billing/${provider}/link`).set({ Authorization: `Bearer ${c.token}` }).send({ plan: 'STANDARD', forMonth });
  /** Pays an invoice through Payme from start to end; returns the invoice id. */
  const payByPayme = async (c: { token: string }, forMonth: string, txId: string) => {
    const l = (await link(c, forMonth).expect(201)).body;
    await payme('CreateTransaction', { id: txId, time: Date.now(), amount: l.amount * 100, account: { transaction_param: l.subscriptionId } }).expect(200);
    const perform = (await payme('PerformTransaction', { id: txId }).expect(200)).body;
    expect(perform.result?.state).toBe(2);
    return l.subscriptionId as string;
  };

  beforeAll(async () => {
    Object.assign(process.env, ENV);
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    lifecycle = app.get(BillingLifecycleService);
  }, 120_000);

  beforeEach(() => {
    process.env.BILLING_ENFORCE = 'off';
  });
  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('a payment buys a period; a second one adds a month to it, not to today', async () => {
    const c = await center();
    const t0 = Date.now();
    await payByPayme(c, '2026-11', `pm-a-${tail}`);
    const first = (await tenant(c.id)).paidUntil!;
    expect(first.getTime()).toBeGreaterThan(t0 + 27 * DAY);
    expect(first.getTime()).toBeLessThan(t0 + 32 * DAY);
    expect((await tenant(c.id)).status).toBe('ACTIVE');
    await payByPayme(c, '2026-12', `pm-b-${tail}`);
    const second = (await tenant(c.id)).paidUntil!;
    expect(second.getTime() - first.getTime()).toBeGreaterThan(27 * DAY);
  });

  it('a payment link never reopens a paid month: the server picks the next month, whatever the browser asks', async () => {
    const c = await center();
    const id = await payByPayme(c, '2026-11', `pm-c-${tail}`);
    const paidMonth = (await invoice(id)).forMonth;
    // The browser asks for the paid month again: it gets a new invoice for the next one.
    const res = (await link(c, paidMonth, 'click').expect(201)).body;
    expect(res.subscriptionId).not.toBe(id);
    expect((await invoice(res.subscriptionId)).forMonth > paidMonth).toBe(true);
    expect((await invoice(id)).status).toBe('PAID');
  });

  it('Payme: the amount is checked, one transaction per invoice, retries change nothing, a cancel after payment takes the month back', async () => {
    const c = await center();
    const l = (await link(c, '2026-11').expect(201)).body;
    const account = { transaction_param: l.subscriptionId };
    expect((await payme('CreateTransaction', { id: `pm-x-${tail}`, time: Date.now(), amount: 1, account })).body.error?.code).toBe(-31001);
    expect((await payme('CreateTransaction', { id: `pm-d-${tail}`, time: Date.now(), amount: l.amount * 100, account })).body.result?.state).toBe(1);
    // A second transaction for the same invoice while the first is open: refused.
    expect((await payme('CreateTransaction', { id: `pm-e-${tail}`, time: Date.now(), amount: l.amount * 100, account })).body.error?.code).toBe(-31051);
    // The same one again: the same answer.
    expect((await payme('CreateTransaction', { id: `pm-d-${tail}`, time: Date.now(), amount: l.amount * 100, account })).body.result?.state).toBe(1);
    await payme('PerformTransaction', { id: `pm-d-${tail}` }).expect(200);
    const paid = (await tenant(c.id)).paidUntil!;
    // A retried perform does not add a second month.
    expect((await payme('PerformTransaction', { id: `pm-d-${tail}` })).body.result?.state).toBe(2);
    expect((await tenant(c.id)).paidUntil!.getTime()).toBe(paid.getTime());
    // Refunded: the month goes back, the invoice is cancelled.
    expect((await payme('CancelTransaction', { id: `pm-d-${tail}`, reason: 5 })).body.result?.state).toBe(-2);
    expect((await invoice(l.subscriptionId)).status).toBe('CANCELLED');
    const after = (await tenant(c.id)).paidUntil;
    expect(after === null || after.getTime() <= Date.now() + 1000).toBe(true);
    expect((await payme('CheckTransaction', { id: `pm-d-${tail}` })).body.result?.state).toBe(-2);
  });

  it('Click: a paid invoice is not prepared again; a repeated confirmation adds one month', async () => {
    const c = await center();
    const l = (await link(c, '2026-11', 'click').expect(201)).body;
    expect((await click('0', l.subscriptionId, l.amount, `ck-a-${tail}`)).body.error).toBe(0);
    expect((await click('1', l.subscriptionId, l.amount, `ck-a-${tail}`)).body.error).toBe(0);
    const paid = (await tenant(c.id)).paidUntil!;
    expect((await click('1', l.subscriptionId, l.amount, `ck-a-${tail}`)).body.error).toBe(-4);
    expect((await tenant(c.id)).paidUntil!.getTime()).toBe(paid.getTime());
    expect((await click('0', l.subscriptionId, l.amount, `ck-b-${tail}`)).body.error).toBe(-4);
  });

  it('when the period runs out: PAST_DUE for the grace days, then suspended for non-payment; paying brings it back', async () => {
    process.env.BILLING_ENFORCE = 'on';
    const c = await center();
    await payByPayme(c, '2026-11', `pm-f-${tail}`);
    const until = (await tenant(c.id)).paidUntil!.getTime();
    await lifecycle.run(new Date(until - DAY), [c.id]);
    expect((await tenant(c.id)).status).toBe('ACTIVE');
    await lifecycle.run(new Date(until + DAY), [c.id]);
    expect((await tenant(c.id)).status).toBe('PAST_DUE');
    // The grace days: the center still works.
    await http().post('/api/students').set({ Authorization: `Bearer ${c.token}` }).send({ fullName: 'PS Grace', phone: `+99897${tail}01` }).expect(201);
    await lifecycle.run(new Date(until + 8 * DAY), [c.id]);
    expect(await tenant(c.id)).toMatchObject({ status: 'SUSPENDED', suspendedReason: 'NON_PAYMENT' });
    const refused = await http().post('/api/students').set({ Authorization: `Bearer ${c.token}` }).send({ fullName: 'PS Late', phone: `+99897${tail}02` });
    expect([refused.status, refused.body.code]).toEqual([403, 'BILLING_SUSPENDED']);
    // Paying is still open, and brings the center back.
    await payByPayme(c, '2026-12', `pm-g-${tail}`);
    expect(await tenant(c.id)).toMatchObject({ status: 'ACTIVE', suspendedReason: null });
  });

  it("a center the platform admin suspended stays suspended when it pays (the payment still counts)", async () => {
    const c = await center();
    await db.update(tenants).set({ status: 'SUSPENDED', suspendedReason: null }).where(eq(tenants.id, c.id));
    await payByPayme(c, '2026-11', `pm-h-${tail}`);
    const t = await tenant(c.id);
    expect(t.status).toBe('SUSPENDED');
    expect(t.paidUntil).not.toBeNull();
  });

  it('with BILLING_ENFORCE off nothing changes; the preview says what would', async () => {
    const c = await center();
    await payByPayme(c, '2026-11', `pm-i-${tail}`);
    const until = (await tenant(c.id)).paidUntil!.getTime();
    await lifecycle.run(new Date(until + 30 * DAY), [c.id]);
    expect((await tenant(c.id)).status).toBe('ACTIVE');
    const dry = await lifecycle.run(new Date(until + 30 * DAY), [c.id], { dryRun: true });
    expect(dry.report).toEqual([expect.objectContaining({ tenantId: c.id, from: 'ACTIVE', to: 'SUSPENDED' })]);
    expect((await tenant(c.id)).status).toBe('ACTIVE');
  });

  it('centers with no paid period (old or comped) are never touched', async () => {
    process.env.BILLING_ENFORCE = 'on';
    const c = await center();
    await db.update(tenants).set({ status: 'ACTIVE', paidUntil: null }).where(eq(tenants.id, c.id));
    await lifecycle.run(new Date(Date.now() + 400 * DAY), [c.id]);
    expect((await tenant(c.id)).status).toBe('ACTIVE');
  });
});
