import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash, randomUUID } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { and, eq, sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { auditLogs, organizationMemberships, platformPaymentClaims, platformSubscriptions, tenants, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { EmailService } from '../src/email/email.service.js';
import { NoticeOutboxService } from '../src/notice-outbox/notice-outbox.service.js';
import { UPLOAD_DIR } from '../src/common/upload.util.js';
import { CHECKS } from '../scripts/check-platform-billing.js';

// A center pays the platform by card transfer: the platform's card on the
// plans page, a receipt for a tariff (the month and price are the
// server's), and only the platform admin's "confirm" records the month
// paid. Proven here on PostgreSQL: one transaction for every money write,
// races between admins, confirm against reject, a failure in the middle,
// parallel uploads and retries, and clashes with Click and Payme.
describe('Paying the platform by card (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  let n = 0;
  const http = () => request(app.getHttpServer());
  let sa: Record<string, string>;
  const told: string[] = [];
  let outbox: NoticeOutboxService;
  const PAYME_KEY = 'pc_payme_key';
  const CLICK = { merchant: 'pc_click_m', service: 'pc_click_s', secret: 'pc_click_secret' };
  // A marker in every receipt this suite uploads: its files are told apart
  // from other suites' uploads in the shared folder.
  const MARK = `pcard-${suffix}`;
  // `v`: one character that makes another picture of the same size.
  const receipt = (v = 'A') => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(MARK + v)]);
  // Only files of this suite's exact size, written since it began, are read.
  const started = Date.now() - 5_000;
  const ourFiles = () => readdirSync(UPLOAD_DIR).filter((f) => {
    try {
      const path = join(UPLOAD_DIR, f);
      const st = statSync(path);
      return st.size === receipt().length && st.mtimeMs >= started && readFileSync(path).includes(MARK);
    } catch {
      return false;
    }
  });

  beforeAll(async () => {
    Object.assign(process.env, {
      PLATFORM_CARD_NUMBER: '',
      PLATFORM_CARD_HOLDER: '',
      PLATFORM_PAYME_MERCHANT_ID: 'pc_payme_m',
      PLATFORM_PAYME_KEY: PAYME_KEY,
      PLATFORM_CLICK_MERCHANT_ID: CLICK.merchant,
      PLATFORM_CLICK_SERVICE_ID: CLICK.service,
      PLATFORM_CLICK_SECRET_KEY: CLICK.secret,
    });
    // Many sign-ups from one address: the per-address throttle has its own suites.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const tg = app.get(TelegramService);
    tg.deliverMessage = (async (_c: string, text: string) => {
      told.push(text);
      return { ok: true };
    }) as typeof tg.deliverMessage;
    const mail = app.get(EmailService);
    mail.deliver = (async () => ({ accepted: true })) as typeof mail.deliver;
    outbox = app.get(NoticeOutboxService);
    // This suite's worker sends this suite's messages only (center() adds each center).
    outbox.onlyTenants = [];
    outbox.paused = false;

    const email = `pcard-sa-${suffix}@test.uz`;
    const s = (await http().post('/api/auth/register').send({ centerName: `PSa ${suffix}`, subdomain: `psa-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN', telegramChatId: `1${String(suffix).slice(-8)}` }).where(eq(users.id, s.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, s.user.id));
    sa = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken}` };
  });

  afterAll(async () => {
    for (const k of ['PLATFORM_CARD_NUMBER', 'PLATFORM_CARD_HOLDER', 'PLATFORM_PAYME_MERCHANT_ID', 'PLATFORM_PAYME_KEY', 'PLATFORM_CLICK_MERCHANT_ID', 'PLATFORM_CLICK_SERVICE_ID', 'PLATFORM_CLICK_SECRET_KEY']) delete process.env[k];
    await app?.close();
  });

  const card = () => {
    process.env.PLATFORM_CARD_NUMBER = '9860 1234 5678 9012';
    process.env.PLATFORM_CARD_HOLDER = 'Platform Egasi';
  };

  /** A new center with its owner linked to the bot. */
  async function center() {
    const i = ++n;
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `PCard ${i} ${suffix}`, subdomain: `pc${i}-${suffix}`, email: `pc${i}-${suffix}@test.uz`, password: 'password123', fullName: 'PCard Owner' })
      .expect(201)).body;
    await db.update(users).set({ telegramChatId: `2${i}${String(suffix).slice(-7)}` }).where(eq(users.id, reg.user.id));
    const tenantId = (reg.tenant?.id ?? reg.user.tenantId) as string;
    outbox.onlyTenants!.push(tenantId);
    return { auth: { Authorization: `Bearer ${reg.accessToken}` }, tenantId };
  }

  const send = (auth: Record<string, string>, opts: { plan?: string; key?: string; file?: boolean; forMonth?: string; v?: string; note?: string } = {}) => {
    let r = http().post('/api/platform-billing/card').set(auth).field('plan', opts.plan ?? 'STANDARD');
    if (opts.forMonth) r = r.field('forMonth', opts.forMonth);
    if (opts.note) r = r.field('note', opts.note);
    if (opts.key) r = r.set('Idempotency-Key', opts.key);
    return opts.file === false ? r : r.attach('file', receipt(opts.v), { filename: 'chek.png', contentType: 'image/png' });
  };
  const confirm = (id: string) => http().post(`/api/platform/card-claims/${id}/confirm`).set(sa);
  const reject = (id: string, reason = 'Pul kelmadi') => http().post(`/api/platform/card-claims/${id}/reject`).set(sa).send({ reason });
  const tenantRow = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0];
  const invoices = (tenantId: string) => db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId));
  const paymentAudits = (tenantId: string) => db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entityType, 'platform_payment')));
  const payme = (method: string, params: Record<string, unknown>, key = PAYME_KEY) =>
    http().post('/api/platform-billing/payme/webhook').set('Authorization', 'Basic ' + Buffer.from(`Paycom:${key}`).toString('base64')).send({ id: 1, method, params }).expect(200);
  const md5 = (s: string) => createHash('md5').update(s).digest('hex');
  const click = (subId: string, amount: number, action: '0' | '1', trans: string) => {
    const t = '2026-10-26 10:00:00';
    const sign = action === '0'
      ? md5(`${trans}${CLICK.service}${CLICK.secret}${subId}${amount}${action}${t}`)
      : md5(`${trans}${CLICK.service}${CLICK.secret}${subId}${subId}${amount}${action}${t}`);
    return http().post('/api/platform-billing/click/webhook').send({ click_trans_id: trans, service_id: CLICK.service, merchant_trans_id: subId, merchant_prepare_id: action === '1' ? subId : undefined, amount, action, sign_time: t, sign_string: sign, error: '0' }).expect(200);
  };

  it('no card set: nothing to pay to', async () => {
    const c = await center();
    expect((await http().get('/api/platform-billing/card').set(c.auth).expect(200)).body.card).toBeNull();
    await send(c.auth).expect(400);
  });

  it('a receipt is confirmed into one paid month; the month and price are the server\'s', async () => {
    card();
    const c = await center();
    const view = (await http().get('/api/platform-billing/card').set(c.auth).expect(200)).body;
    expect(view.card).toEqual({ number: '9860 1234 5678 9012', holder: 'Platform Egasi' });
    await send(c.auth, { file: false }).expect(400);
    await send(c.auth, { plan: 'NO_SUCH_PLAN' }).expect(404);
    // The browser's month (here not even a real one) is ignored.
    const claim = (await send(c.auth, { forMonth: '2026-13' }).expect(201)).body;
    expect(claim.forMonth).toBe(view.nextMonth);
    expect(claim).toMatchObject({ status: 'PENDING', plan: 'STANDARD', replay: false });
    expect(claim.amount).toBeGreaterThan(0);
    await outbox.drain();
    expect(told.some((m) => m.includes(`PCard`) && m.includes(claim.forMonth))).toBe(true);

    await http().post(`/api/platform/card-claims/${claim.id}/confirm`).set(c.auth).expect(403);
    await http().get(`/api/platform/card-claims/${claim.id}/receipt`).set(sa).expect(200);
    const done = (await confirm(claim.id).expect(201)).body;
    expect(done).toMatchObject({ status: 'CONFIRMED', replay: false });
    const t = await tenantRow(c.tenantId);
    expect(t.paidUntil).not.toBeNull();
    expect(t.status).toBe('ACTIVE');
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
    expect(await paymentAudits(c.tenantId)).toHaveLength(1);

    // The next receipt is for the next month.
    const next = (await send(c.auth).expect(201)).body;
    expect(next.forMonth > claim.forMonth).toBe(true);
  });

  it('two admins confirm at once: the subscription grows once and both get the same answer', async () => {
    card();
    const c = await center();
    const claim = (await send(c.auth).expect(201)).body;
    const [a, b] = await Promise.all([confirm(claim.id), confirm(claim.id)]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect([a.body.replay, b.body.replay].sort()).toEqual([false, true]);
    expect(a.body.subscriptionId).toBe(b.body.subscriptionId);
    const paid = (await invoices(c.tenantId)).filter((s) => s.status === 'PAID');
    expect(paid).toHaveLength(1);
    expect((await tenantRow(c.tenantId)).paidUntil!.getTime()).toBe(paid[0].periodEnd!.getTime());
    expect(await paymentAudits(c.tenantId)).toHaveLength(1);
    // A later retry of the same confirm: the same, already-decided answer.
    expect((await confirm(claim.id).expect(201)).body).toMatchObject({ status: 'CONFIRMED', replay: true, subscriptionId: a.body.subscriptionId });
    await reject(claim.id).expect(409);
  });

  it('confirm and reject at once: exactly one wins, and the state matches it', async () => {
    card();
    for (let i = 0; i < 3; i++) {
      const c = await center();
      const claim = (await send(c.auth).expect(201)).body;
      const [ok, no] = await Promise.all([confirm(claim.id), reject(claim.id)]);
      const [row] = await db.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.id, claim.id));
      const paid = (await invoices(c.tenantId)).filter((s) => s.status === 'PAID');
      if (row.status === 'CONFIRMED') {
        expect([ok.status, no.status]).toEqual([201, 409]);
        expect(paid).toHaveLength(1);
      } else {
        expect(row.status).toBe('REJECTED');
        expect([ok.status, no.status]).toEqual([409, 201]);
        expect(paid).toHaveLength(0);
        expect((await tenantRow(c.tenantId)).paidUntil).toBeNull();
      }
    }
  });

  it('a failure in the middle of a confirm leaves nothing half done', async () => {
    card();
    const c = await center();
    const claim = (await send(c.auth).expect(201)).body;
    // Fault injection: the center's row refuses the update that extends it
    // (the last money write of the confirm).
    const fn = `pc_fail_${suffix}`;
    await db.execute(sql.raw(`create or replace function ${fn}() returns trigger language plpgsql as $$ begin if new.id = '${c.tenantId}' and new.paid_until is distinct from old.paid_until then raise exception 'injected failure'; end if; return new; end $$`));
    await db.execute(sql.raw(`create trigger ${fn} before update on tenants for each row execute function ${fn}()`));
    try {
      await confirm(claim.id).expect(500);
    } finally {
      await db.execute(sql.raw(`drop trigger if exists ${fn} on tenants`));
      await db.execute(sql.raw(`drop function if exists ${fn}()`));
    }
    const [row] = await db.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.id, claim.id));
    expect(row).toMatchObject({ status: 'PENDING', subscriptionId: null, reviewedByUserId: null });
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(0);
    expect((await tenantRow(c.tenantId)).paidUntil).toBeNull();
    expect(await paymentAudits(c.tenantId)).toHaveLength(0);
    // Once the fault is gone, the same receipt confirms normally.
    await confirm(claim.id).expect(201);
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
  });

  it('parallel uploads, a double click and a retry make one receipt and leave no stray files', async () => {
    card();
    const c = await center();
    const before = ourFiles().length;
    // Two tabs at once, each its own send.
    const [x, y] = await Promise.all([send(c.auth, { key: randomUUID() }), send(c.auth, { key: randomUUID() })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(ourFiles().length - before).toBe(1);
    const first = x.status === 201 ? x.body : y.body;

    // The same send retried (a double click, a retry after a timeout): the same receipt back.
    const c2 = await center();
    const key = randomUUID();
    const [p, q] = await Promise.all([send(c2.auth, { key }), send(c2.auth, { key })]);
    expect([p.status, q.status]).toEqual([201, 201]);
    expect(p.body.id).toBe(q.body.id);
    expect([p.body.replay, q.body.replay].sort()).toEqual([false, true]);
    const later = (await send(c2.auth, { key }).expect(201)).body;
    expect(later).toMatchObject({ id: p.body.id, replay: true });
    expect(ourFiles().length - before).toBe(2);
    expect(await db.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.tenantId, c2.tenantId))).toHaveLength(1);

    // A bad key is refused and its upload removed.
    await send(c2.auth, { key: 'x' }).expect(400);
    expect(ourFiles().length - before).toBe(2);

    // After a rejection a new receipt for the same month is accepted.
    await reject(first.id).expect(201);
    const again = (await send(c.auth).expect(201)).body;
    expect(again.forMonth).toBe(first.forMonth);
  }, 90_000); // several sign-ups and uploads; slower when the whole suite runs at once

  it('the same key with other content is a conflict, never the old receipt; a plain retry keeps the key; files in use stay', async () => {
    card();
    const c = await center();
    const before = ourFiles().length;
    const key = randomUUID();
    // The first send reached the server, its answer was lost (a timeout).
    const first = (await send(c.auth, { key, v: 'A' }).expect(201)).body;
    // A plain retry: same key, same picture -> the same receipt, the copy removed.
    expect((await send(c.auth, { key, v: 'A' }).expect(201)).body).toMatchObject({ id: first.id, replay: true });
    expect(ourFiles().length - before).toBe(1);
    // The user picked another picture but the browser kept the key: 409, not "sent".
    const other = await send(c.auth, { key, v: 'B' }).expect(409);
    expect(other.body.code).toBe('KEY_REUSED');
    // ... or another tariff, or another note.
    expect((await send(c.auth, { key, v: 'A', plan: 'PRO' }).expect(409)).body.code).toBe('KEY_REUSED');
    expect((await send(c.auth, { key, v: 'A', note: 'boshqa' }).expect(409)).body.code).toBe('KEY_REUSED');
    // A new picture as a new send (a new key) while the first waits: the month already has a receipt.
    const fresh = await send(c.auth, { key: randomUUID(), v: 'B' }).expect(409);
    expect(fresh.body.code).toBe('PENDING');
    // Only the receipt in use is on disk; the stored one is untouched.
    expect(ourFiles().length - before).toBe(1);
    const [row] = await db.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.id, first.id));
    expect(existsSync(join(UPLOAD_DIR, row.receiptFile))).toBe(true);
    expect(row.receiptSha256).toBe(createHash('sha256').update(receipt('A')).digest('hex'));

    // Rejected: the next receipt is a new send with a new key, accepted.
    await reject(first.id).expect(201);
    const second = (await send(c.auth, { key: randomUUID(), v: 'B' }).expect(201)).body;
    expect(second).toMatchObject({ status: 'PENDING', replay: false });
    expect(second.id).not.toBe(first.id);
    // The old key replayed (an old tab): the rejected receipt comes back as it is - REJECTED, not a success.
    expect((await send(c.auth, { key, v: 'A' }).expect(201)).body).toMatchObject({ id: first.id, status: 'REJECTED', replay: true });
    expect(ourFiles().length - before).toBe(2);
  }, 90_000);

  it('early renewal pays for the month the paid time runs out in; an expired one for this month', async () => {
    card();
    const c = await center();
    await db.update(tenants).set({ paidUntil: new Date(Date.now() + 40 * 86_400_000), timezone: 'Asia/Tashkent' }).where(eq(tenants.id, c.tenantId));
    const ahead = new Date(Date.now() + 40 * 86_400_000);
    const label = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(ahead);
    expect((await send(c.auth).expect(201)).body.forMonth).toBe(label);

    const d = await center();
    await db.update(tenants).set({ paidUntil: new Date(Date.now() - 40 * 86_400_000) }).where(eq(tenants.id, d.tenantId));
    const now = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit' }).format(new Date());
    expect((await send(d.auth).expect(201)).body.forMonth).toBe(now);
    // Click and Payme links get the same month, whatever the browser says.
    const link = (await http().post('/api/platform-billing/click/link').set(d.auth).send({ plan: 'STANDARD', forMonth: '1999-01' }).expect(201)).body;
    const [inv] = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, link.subscriptionId));
    expect(inv.forMonth).toBe(now);
  });

  it('Payme under way: the card confirm waits; the provider transaction is never taken over', async () => {
    card();
    const c = await center();
    const claim = (await send(c.auth).expect(201)).body;
    const link = (await http().post('/api/platform-billing/payme/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
    const amount = link.amount * 100;
    expect((await payme('CreateTransaction', { id: 'pc-tx-1', time: Date.now(), amount, account: { transaction_param: link.subscriptionId } })).body.result.state).toBe(1);

    const refused = await confirm(claim.id).expect(409);
    expect(refused.body.code).toBe('PAYMENT_IN_PROGRESS');
    const [inv] = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, link.subscriptionId));
    expect(inv).toMatchObject({ status: 'PENDING', providerTxId: 'pc-tx-1', provider: 'PAYME' });

    // Payme completes: paid once; the card receipt for that month is now refused (the admin rejects it).
    expect((await payme('PerformTransaction', { id: 'pc-tx-1' })).body.result.state).toBe(2);
    expect((await confirm(claim.id).expect(409)).body.code).toBe('ALREADY_PAID');
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
    // A retried, late Perform answers the same and changes nothing.
    expect((await payme('PerformTransaction', { id: 'pc-tx-1' })).body.result.state).toBe(2);
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
  });

  it('a card-paid month is not paid again by Payme or Click', async () => {
    card();
    const c = await center();
    const link = (await http().post('/api/platform-billing/payme/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
    const clickLink = (await http().post('/api/platform-billing/click/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
    expect(clickLink.subscriptionId).toBe(link.subscriptionId); // one live invoice for the month
    const claim = (await send(c.auth).expect(201)).body;
    await confirm(claim.id).expect(201);
    const busy = (await payme('CheckPerformTransaction', { amount: link.amount * 100, account: { transaction_param: link.subscriptionId } })).body;
    expect(busy.error.code).toBe(-31051);
    expect((await click(link.subscriptionId, link.amount, '1', 'pc-click-late')).body.error).toBe(-4);
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
  });

  it('a card confirm racing a Click payment: the month is paid once, and the loser says so', async () => {
    card();
    for (let i = 0; i < 3; i++) {
      const c = await center();
      const link = (await http().post('/api/platform-billing/click/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
      const claim = (await send(c.auth).expect(201)).body;
      expect(claim.forMonth).toBe((await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, link.subscriptionId)))[0].forMonth);
      const [cardRes, clickRes] = await Promise.all([confirm(claim.id), click(link.subscriptionId, link.amount, '1', `pc-race-${i}`)]);
      const cardWon = cardRes.status === 201;
      const clickWon = clickRes.body.error === 0;
      expect(cardWon !== clickWon).toBe(true);
      if (!cardWon) expect(cardRes.body.code).toBe('ALREADY_PAID');
      if (!clickWon) expect(clickRes.body.error).toBe(-4);
      const paid = (await invoices(c.tenantId)).filter((s) => s.status === 'PAID');
      expect(paid).toHaveLength(1);
      expect((await tenantRow(c.tenantId)).paidUntil!.getTime()).toBe(paid[0].periodEnd!.getTime());
    }
  });

  it('a Payme transaction that timed out is closed as cancelled and kept for Payme; the card pays the month', async () => {
    card();
    const c = await center();
    const link = (await http().post('/api/platform-billing/payme/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
    await payme('CreateTransaction', { id: 'pc-tx-old', time: Date.now(), amount: link.amount * 100, account: { transaction_param: link.subscriptionId } });
    await db.update(platformSubscriptions).set({ providerCreatedAt: new Date(Date.now() - 13 * 3_600_000) }).where(eq(platformSubscriptions.id, link.subscriptionId));
    const claim = (await send(c.auth).expect(201)).body;
    await confirm(claim.id).expect(201);
    const rows = await invoices(c.tenantId);
    const old = rows.find((r) => r.id === link.subscriptionId)!;
    expect(old).toMatchObject({ status: 'CANCELLED', providerTxId: 'pc-tx-old', cancelReason: 4 });
    expect(rows.filter((r) => r.status === 'PAID')).toHaveLength(1);
    // Payme asking about its old transaction still gets a true answer.
    expect((await payme('CheckTransaction', { id: 'pc-tx-old' })).body.result.state).toBe(-1);
    expect((await payme('PerformTransaction', { id: 'pc-tx-old' })).body.error.code).toBe(-31008);
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
  });

  it('a payment cancelled after it was made takes its month back', async () => {
    card();
    const c = await center();
    const link = (await http().post('/api/platform-billing/payme/link').set(c.auth).send({ plan: 'STANDARD' }).expect(201)).body;
    await payme('CreateTransaction', { id: 'pc-tx-ref', time: Date.now(), amount: link.amount * 100, account: { transaction_param: link.subscriptionId } });
    await payme('PerformTransaction', { id: 'pc-tx-ref' });
    const paidUntil = (await tenantRow(c.tenantId)).paidUntil!;
    expect((await payme('CancelTransaction', { id: 'pc-tx-ref', reason: 5 })).body.result.state).toBe(-2);
    expect((await tenantRow(c.tenantId)).paidUntil!.getTime()).toBeLessThan(paidUntil.getTime());
    // The month is open again: a card receipt for it confirms.
    const claim = (await send(c.auth).expect(201)).body;
    await confirm(claim.id).expect(201);
    expect((await invoices(c.tenantId)).filter((s) => s.status === 'PAID')).toHaveLength(1);
  });

  it('the admin list pages through every receipt, oldest waiting ones first', async () => {
    card();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await send((await center()).auth).expect(201)).body.id);
    const all: string[] = [];
    let page = 1;
    let total = 0;
    for (;;) {
      const res = (await http().get(`/api/platform/card-claims?status=PENDING&page=${page}&pageSize=2`).set(sa).expect(200)).body;
      total = res.total;
      expect(res.items.length).toBeLessThanOrEqual(2);
      all.push(...res.items.map((x: { id: string }) => x.id));
      if (res.items.length < 2) break;
      page++;
    }
    expect(new Set(all).size).toBe(all.length); // no row twice
    expect(all.length).toBe(total);
    for (const id of ids) expect(all).toContain(id);
    // Oldest first: ours were made in order.
    expect(all.indexOf(ids[0])).toBeLessThan(all.indexOf(ids[2]));
    await http().get('/api/platform/card-claims').set((await center()).auth).expect(403);
  });

  it('a center whose trial is over can still pay by card', async () => {
    card();
    const c = await center();
    await db.update(tenants).set({ status: 'TRIAL', trialEndsAt: new Date('2020-01-01') }).where(eq(tenants.id, c.tenantId));
    await http().get('/api/platform-billing/card').set(c.auth).expect(200);
    await send(c.auth).expect(201);
  });

  it('the read-only consistency check finds nothing wrong with what this suite did', async () => {
    const ours = new Set((await db.select({ id: tenants.id }).from(tenants).where(sql`${tenants.subdomain} like ${`pc%-${suffix}`}`)).map((r) => r.id));
    for (const c of CHECKS) {
      const rows = (await db.execute(sql.raw(c.sql))).rows as Array<{ tenant_id?: string }>;
      expect(rows.filter((r) => r.tenant_id && ours.has(r.tenant_id)), c.name).toEqual([]);
    }
  });
});
