import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'crypto';
import { Client } from 'pg';
import { and, eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { organizationMemberships, platformSubscriptions, tenants, users } from '../src/db/schema.js';
import { EmailService } from '../src/email/email.service.js';

// Click/Payme callbacks against a change of the same invoice. The amount a
// callback checks and the state it writes are one locked step: a plan or
// amount changed while a callback is under way never activates the new
// plan for the old amount. Also: parallel prepare/complete, Payme
// create/perform/cancel, the card confirm and a payment by hand on one
// month; a provider's transaction id never lands on another provider's or
// another invoice. Test keys only: no real provider and no real money.
describe('Platform billing: callbacks racing invoice changes (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  let n = 0;
  const http = () => request(app.getHttpServer());
  let sa: Record<string, string>;
  const PAYME_KEY = 'race_payme_key';
  const CLICK = { merchant: 'race_click_m', service: 'race_click_s', secret: 'race_click_secret' };
  const STANDARD = 300_000;
  const PREMIUM = 600_000;

  beforeAll(async () => {
    Object.assign(process.env, {
      PLATFORM_CARD_NUMBER: '9860 1234 5678 9012',
      PLATFORM_CARD_HOLDER: 'Race Egasi',
      PLATFORM_PAYME_MERCHANT_ID: 'race_payme_m',
      PLATFORM_PAYME_KEY: PAYME_KEY,
      PLATFORM_CLICK_MERCHANT_ID: CLICK.merchant,
      PLATFORM_CLICK_SERVICE_ID: CLICK.service,
      PLATFORM_CLICK_SECRET_KEY: CLICK.secret,
    });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const mail = app.get(EmailService);
    mail.deliver = (async () => ({ accepted: true })) as typeof mail.deliver;
    const email = `race-sa-${suffix}@test.uz`;
    const s = (await http().post('/api/auth/register').send({ centerName: `RSa ${suffix}`, subdomain: `rsa-${suffix}`, email, password: 'password123', fullName: 'Race Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, s.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, s.user.id));
    sa = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken}` };
  });

  afterAll(async () => {
    for (const k of ['PLATFORM_CARD_NUMBER', 'PLATFORM_CARD_HOLDER', 'PLATFORM_PAYME_MERCHANT_ID', 'PLATFORM_PAYME_KEY', 'PLATFORM_CLICK_MERCHANT_ID', 'PLATFORM_CLICK_SERVICE_ID', 'PLATFORM_CLICK_SECRET_KEY']) delete process.env[k];
    await app?.close();
  });

  async function center() {
    const i = ++n;
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Race ${i} ${suffix}`, subdomain: `rc${i}-${suffix}`, email: `rc${i}-${suffix}@test.uz`, password: 'password123', fullName: 'Race Owner' })
      .expect(201)).body;
    return { auth: { Authorization: `Bearer ${reg.accessToken}` }, tenantId: (reg.tenant?.id ?? reg.user.tenantId) as string };
  }
  const link = async (auth: Record<string, string>, provider: 'click' | 'payme', plan: string) =>
    (await http().post(`/api/platform-billing/${provider}/link`).set(auth).send({ plan }).expect(201)).body as { subscriptionId: string; amount: number };
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const click = (subId: string, amount: number, action: '0' | '1', trans: string) => {
    const t = '2026-10-26 10:00:00';
    const sign = action === '0'
      ? md5(`${trans}${CLICK.service}${CLICK.secret}${subId}${amount}${action}${t}`)
      : md5(`${trans}${CLICK.service}${CLICK.secret}${subId}${subId}${amount}${action}${t}`);
    return http().post('/api/platform-billing/click/webhook')
      .send({ click_trans_id: trans, service_id: CLICK.service, merchant_trans_id: subId, merchant_prepare_id: action === '1' ? subId : undefined, amount, action, sign_time: t, sign_string: sign, error: '0' })
      .expect(200);
  };
  const payme = (method: string, params: Record<string, unknown>) =>
    http().post('/api/platform-billing/payme/webhook').set('Authorization', 'Basic ' + Buffer.from(`Paycom:${PAYME_KEY}`).toString('base64')).send({ id: 1, method, params }).expect(200);
  const invoice = async (id: string) => (await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, id)))[0];
  const tenantRow = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0];

  /**
   * Holds the invoice's row lock in a connection of its own; `whileHeld`
   * runs once another backend is waiting for that lock (the callback has
   * read the invoice and is about to write it), then the change commits.
   */
  async function changeWhileCallbackWaits(subId: string, callback: () => Promise<request.Response>, change: { plan: string; amount: number }) {
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      await c.query('begin');
      const me = (await c.query('select pg_backend_pid() as pid')).rows[0].pid as number;
      await c.query('select id from platform_subscriptions where id = $1 for update', [subId]);
      // supertest sends on .then(): start the request now.
      const pending = new Promise<request.Response>((resolve, reject) => callback().then(resolve, reject));
      // Deterministic, not a sleep: wait until a backend is blocked behind this one.
      for (let i = 0; ; i++) {
        const { rows } = await c.query(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [me]);
        if (rows[0].n > 0) break;
        if (i > 500) throw new Error('the callback never reached the invoice');
        await new Promise((r) => setTimeout(r, 10));
      }
      // "Another request changes the plan and amount" (what a new link does to a CREATED invoice).
      await c.query(`update platform_subscriptions set plan = $2, amount = $3 where id = $1`, [subId, change.plan, change.amount]);
      await c.query('commit');
      return await pending;
    } finally {
      await c.end().catch(() => undefined);
    }
  }

  it('Click complete: the plan and amount change while the callback waits -> the new plan is not activated for the old amount', async () => {
    const c = await center();
    const inv = await link(c.auth, 'click', 'STANDARD');
    expect(inv.amount).toBe(STANDARD);
    expect((await click(inv.subscriptionId, STANDARD, '0', `rc-a-${suffix}`)).body.error).toBe(0);
    const res = await changeWhileCallbackWaits(inv.subscriptionId, () => click(inv.subscriptionId, STANDARD, '1', `rc-a-${suffix}`), { plan: 'PREMIUM', amount: PREMIUM });
    const after = await invoice(inv.subscriptionId);
    const t = await tenantRow(c.tenantId);
    // Never: PREMIUM paid with the STANDARD amount.
    expect(after.status === 'PAID' && after.plan === 'PREMIUM' && after.amount !== STANDARD).toBe(false);
    expect(res.body.error).toBe(-2); // Click: incorrect amount
    expect(after.status).toBe('CREATED');
    expect(t.paidUntil).toBeNull();
    expect(t.plan).not.toBe('PREMIUM');
  });

  it('Payme CreateTransaction: the same race -> no transaction opened for the old amount', async () => {
    const c = await center();
    const inv = await link(c.auth, 'payme', 'STANDARD');
    const res = await changeWhileCallbackWaits(inv.subscriptionId, () => payme('CreateTransaction', { id: `pm-race-${suffix}`, time: Date.now(), amount: STANDARD * 100, account: { transaction_param: inv.subscriptionId } }), { plan: 'PREMIUM', amount: PREMIUM });
    expect(res.body.error?.code).toBe(-31001); // incorrect amount
    const after = await invoice(inv.subscriptionId);
    expect(after).toMatchObject({ status: 'CREATED', providerTxId: null });
  });

  it('a new link between Click prepare and complete: the old amount is refused; the new one pays the new plan', async () => {
    const c = await center();
    const a = await link(c.auth, 'click', 'STANDARD');
    expect((await click(a.subscriptionId, STANDARD, '0', `rc-b-${suffix}`)).body.error).toBe(0);
    const b = await link(c.auth, 'click', 'PREMIUM');
    expect(b.subscriptionId).toBe(a.subscriptionId); // the same CREATED invoice, now PREMIUM
    expect((await click(a.subscriptionId, STANDARD, '1', `rc-b-${suffix}`)).body.error).toBe(-2);
    expect((await invoice(a.subscriptionId)).status).toBe('CREATED');
    expect((await click(b.subscriptionId, PREMIUM, '0', `rc-c-${suffix}`)).body.error).toBe(0);
    expect((await click(b.subscriptionId, PREMIUM, '1', `rc-c-${suffix}`)).body.error).toBe(0);
    expect(await invoice(b.subscriptionId)).toMatchObject({ status: 'PAID', plan: 'PREMIUM', amount: PREMIUM, provider: 'CLICK', providerTxId: `rc-c-${suffix}` });
    expect((await tenantRow(c.tenantId)).plan).toBe('PREMIUM');
  });

  it('parallel Click completes for one invoice: paid once, one month', async () => {
    const c = await center();
    const inv = await link(c.auth, 'click', 'STANDARD');
    await click(inv.subscriptionId, STANDARD, '0', `rc-d-${suffix}`);
    const res = await Promise.all(Array.from({ length: 4 }, () => click(inv.subscriptionId, STANDARD, '1', `rc-d-${suffix}`)));
    expect(res.map((r) => r.body.error).sort()).toEqual([-4, -4, -4, 0]);
    const t = await tenantRow(c.tenantId);
    const after = await invoice(inv.subscriptionId);
    expect(after.periodEnd!.getTime()).toBe(t.paidUntil!.getTime());
  });

  it('Payme create/perform/cancel in parallel: one state at the end, the month counted at most once', async () => {
    const c = await center();
    const inv = await link(c.auth, 'payme', 'STANDARD');
    const id = `pm-par-${suffix}`;
    const creates = await Promise.all(Array.from({ length: 3 }, () => payme('CreateTransaction', { id, time: Date.now(), amount: STANDARD * 100, account: { transaction_param: inv.subscriptionId } })));
    expect(creates.every((r) => r.body.result?.state === 1)).toBe(true);
    // A second Payme transaction for the same invoice is refused while one is open.
    expect((await payme('CreateTransaction', { id: `${id}-2`, time: Date.now(), amount: STANDARD * 100, account: { transaction_param: inv.subscriptionId } })).body.error.code).toBe(-31051);
    const [p1, p2, cancel] = await Promise.all([payme('PerformTransaction', { id }), payme('PerformTransaction', { id }), payme('CancelTransaction', { id, reason: 5 })]);
    const after = await invoice(inv.subscriptionId);
    const t = await tenantRow(c.tenantId);
    if (after.status === 'PAID') {
      expect(t.paidUntil!.getTime()).toBe(after.periodEnd!.getTime());
    } else {
      expect(after.status).toBe('CANCELLED');
      // Paid then taken back, or cancelled before: no month left either way.
      expect(t.paidUntil === null || t.paidUntil.getTime() <= Date.now() + 1000).toBe(true);
    }
    // Every answer names one state and they agree with the row.
    const states = [p1, p2, cancel].map((r) => r.body.result?.state ?? r.body.error?.code);
    expect(states.length).toBe(3);
    expect(after.providerTxId).toBe(id);
    expect(after.provider).toBe('PAYME');
  });

  it("a provider's transaction id never lands on another provider's or another invoice", async () => {
    const c = await center();
    const inv = await link(c.auth, 'payme', 'STANDARD');
    const id = `pm-mix-${suffix}`;
    await payme('CreateTransaction', { id, time: Date.now(), amount: STANDARD * 100, account: { transaction_param: inv.subscriptionId } });
    // Click completes the same invoice while Payme's transaction is open: refused, Payme's id stays.
    expect((await click(inv.subscriptionId, STANDARD, '0', id)).body.error).not.toBe(0);
    expect((await click(inv.subscriptionId, STANDARD, '1', id)).body.error).not.toBe(0);
    expect(await invoice(inv.subscriptionId)).toMatchObject({ status: 'PENDING', provider: 'PAYME', providerTxId: id });
    // Payme asking about a Click transaction id finds nothing.
    const c2 = await center();
    const k = await link(c2.auth, 'click', 'STANDARD');
    await click(k.subscriptionId, STANDARD, '0', `rc-x-${suffix}`);
    await click(k.subscriptionId, STANDARD, '1', `rc-x-${suffix}`);
    expect((await payme('CheckTransaction', { id: `rc-x-${suffix}` })).body.error.code).toBe(-31003);
    expect((await payme('PerformTransaction', { id: `rc-x-${suffix}` })).body.error.code).toBe(-31003);
    expect((await payme('CancelTransaction', { id: `rc-x-${suffix}`, reason: 5 })).body.error.code).toBe(-31003);
    expect((await invoice(k.subscriptionId)).status).toBe('PAID');
    // The same Payme id for another invoice: refused.
    const c3 = await center();
    const other = await link(c3.auth, 'payme', 'STANDARD');
    expect((await payme('CreateTransaction', { id, time: Date.now(), amount: STANDARD * 100, account: { transaction_param: other.subscriptionId } })).body.error).toBeDefined();
    expect((await invoice(other.subscriptionId)).providerTxId).toBeNull();
    // A Click id used on one invoice cannot complete another.
    const c4 = await center();
    const k4 = await link(c4.auth, 'click', 'STANDARD');
    await click(k4.subscriptionId, STANDARD, '0', `rc-x-${suffix}`);
    expect((await click(k4.subscriptionId, STANDARD, '1', `rc-x-${suffix}`)).body.error).not.toBe(0);
    expect((await invoice(k4.subscriptionId)).status).toBe('CREATED');
  });

  it('a card confirm, a payment by hand and a Click complete for one month: the month is paid once', async () => {
    const c = await center();
    const inv = await link(c.auth, 'click', 'STANDARD');
    await click(inv.subscriptionId, STANDARD, '0', `rc-e-${suffix}`);
    const claim = (await http().post('/api/platform-billing/card').set(c.auth).field('plan', 'STANDARD')
      .attach('file', Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(`race-${suffix}`)]), { filename: 'chek.png', contentType: 'image/png' }).expect(201)).body;
    const forMonth = (await invoice(inv.subscriptionId)).forMonth;
    const [clickRes, cardRes, manualRes] = await Promise.all([
      click(inv.subscriptionId, STANDARD, '1', `rc-e-${suffix}`),
      http().post(`/api/platform/card-claims/${claim.id}/confirm`).set(sa),
      http().post(`/api/platform/subscriptions/${c.tenantId}/payments`).set(sa).send({ plan: 'STANDARD', forMonth, amount: STANDARD }),
    ]);
    const paidRows = (await db.select().from(platformSubscriptions).where(and(eq(platformSubscriptions.tenantId, c.tenantId), eq(platformSubscriptions.forMonth, forMonth)))).filter((s) => s.status === 'PAID');
    expect(paidRows).toHaveLength(1);
    const winners = [clickRes.body.error === 0, cardRes.status === 201, manualRes.status === 201].filter(Boolean);
    expect(winners).toHaveLength(1);
    const t = await tenantRow(c.tenantId);
    expect(t.paidUntil!.getTime()).toBe(paidRows[0].periodEnd!.getTime());
  });
});
