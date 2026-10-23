import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash, randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { tenantPaymentAccounts } from '../src/db/schema.js';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
function clickSign(p: { click_trans_id: string; service_id: string; secret: string; merchant_trans_id: string; amount: number; action: string; sign_time: string; merchant_prepare_id?: string }) {
  return md5(
    p.action === '0'
      ? `${p.click_trans_id}${p.service_id}${p.secret}${p.merchant_trans_id}${p.amount}${p.action}${p.sign_time}`
      : `${p.click_trans_id}${p.service_id}${p.secret}${p.merchant_trans_id}${p.merchant_prepare_id || ''}${p.amount}${p.action}${p.sign_time}`,
  );
}

// Each center takes online payments into its own Click / Payme account: the
// link carries the center's merchant, its callback is checked with its own
// key and reaches its own transactions only. The secret never comes back.
describe('Center payment accounts (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const center: Record<'A' | 'B' | 'C', { token: string; tenantId: string; studentId: string }> = {} as never;
  const A_SECRET = 'a-click-secret-' + suffix;
  const B_SECRET = 'b-click-secret-' + suffix;
  const A_PAYME_KEY = 'a-payme-key-' + suffix;

  beforeAll(async () => {
    process.env.SETTINGS_KEY = randomBytes(32).toString('base64');
    // The platform-wide account, for centers without their own.
    process.env.CLICK_MERCHANT_ID = 'platform_merchant';
    process.env.CLICK_SERVICE_ID = 'platform_service';
    process.env.CLICK_SECRET_KEY = 'platform-secret';
    delete process.env.PAYME_MERCHANT_ID;
    delete process.env.PAYME_KEY;
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    for (const k of ['A', 'B', 'C'] as const) {
      const reg = (await http().post('/api/auth/register')
        .send({ centerName: `Pay ${k} ${suffix}`, subdomain: `pay-${k.toLowerCase()}-${suffix}`, email: `pay-${k}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${k}` })
        .expect(201)).body;
      const auth = { Authorization: `Bearer ${reg.accessToken}` };
      const studentId = (await http().post('/api/students').set(auth).send({ fullName: `Payer ${k}` }).expect(201)).body.id as string;
      center[k] = { token: reg.accessToken, tenantId: reg.tenant?.id ?? reg.user.tenantId, studentId };
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const as = (k: 'A' | 'B' | 'C') => ({ Authorization: `Bearer ${center[k].token}` });
  const link = (k: 'A' | 'B' | 'C', provider: 'click' | 'payme') =>
    http().post(`/api/billing/${provider}/link`).set(as(k)).send({ studentId: center[k].studentId, amount: 150000, forMonth: '2026-11' });

  it("saves a center's own Click account; the secret is sealed and never shown", async () => {
    await http().put('/api/billing/accounts/CLICK').set(as('A')).send({ merchantId: 'a_merchant', serviceId: 'a_service' }).expect(400); // a new account needs its secret
    await http().put('/api/billing/accounts/CLICK').set(as('A')).send({ merchantId: 'a merchant!', serviceId: 'a_service', secret: A_SECRET }).expect(400);
    const saved = (await http().put('/api/billing/accounts/CLICK').set(as('A')).send({ merchantId: 'a_merchant', serviceId: 'a_service', secret: A_SECRET }).expect(200)).body;
    expect(saved.click).toMatchObject({ connected: true, merchantId: 'a_merchant', serviceId: 'a_service' });
    expect(saved.click.webhookUrl).toMatch(new RegExp(`/billing/click/webhook/${center.A.tenantId}$`));
    expect(JSON.stringify(saved)).not.toContain(A_SECRET);
    const [row] = await db.select().from(tenantPaymentAccounts).where(eq(tenantPaymentAccounts.tenantId, center.A.tenantId));
    expect(row.secret).not.toContain(A_SECRET);

    // An edit without a secret keeps the stored one.
    await http().put('/api/billing/accounts/CLICK').set(as('A')).send({ merchantId: 'a_merchant', serviceId: 'a_service' }).expect(200);
    await http().put('/api/billing/accounts/CLICK').set(as('B')).send({ merchantId: 'b_merchant', serviceId: 'b_service', secret: B_SECRET }).expect(200);
    await http().put('/api/billing/accounts/VISA').set(as('A')).send({ merchantId: 'x', secret: 'y' }).expect(400);
  });

  it("the link goes to the center's own merchant; a center without one falls back to the platform's", async () => {
    expect((await http().get('/api/billing/config').set(as('A')).expect(200)).body).toEqual({ clickEnabled: true, paymeEnabled: false });
    expect((await link('A', 'click').expect(201)).body.url).toContain('a_merchant');
    expect((await link('C', 'click').expect(201)).body.url).toContain('platform_merchant');
    // No Payme anywhere: no button, and the link explains what to do.
    const refused = (await link('A', 'payme').expect(503)).body;
    expect(refused.message).toContain("Onlayn to'lovlar");
  });

  it("a callback on the center's route is checked with its own key and sees only its own payments", async () => {
    const txId = (await link('A', 'click').expect(201)).body.transactionId as string;
    const body = (secret: string, service: string, action = '0', prepare?: string) => {
      const p = { click_trans_id: `ct-${txId}`, service_id: service, merchant_trans_id: txId, amount: 150000, action, sign_time: '2026-11-02 10:00:00', merchant_prepare_id: prepare };
      return { ...p, sign_string: clickSign({ ...p, secret }) };
    };
    // The platform's key on A's route: refused.
    expect((await http().post(`/api/billing/click/webhook/${center.A.tenantId}`).send(body('platform-secret', 'a_service')).expect(200)).body.error).toBe(-1);
    // B's own key on B's route cannot reach A's payment.
    expect((await http().post(`/api/billing/click/webhook/${center.B.tenantId}`).send(body(B_SECRET, 'b_service')).expect(200)).body.error).toBe(-6);
    // Nor can the shared route with the platform's key.
    expect((await http().post('/api/billing/click/webhook').send(body('platform-secret', 'platform_service')).expect(200)).body.error).toBe(-6);
    // A's own key on A's route: prepared, then paid.
    expect((await http().post(`/api/billing/click/webhook/${center.A.tenantId}`).send(body(A_SECRET, 'a_service')).expect(200)).body.error).toBe(0);
    expect((await http().post(`/api/billing/click/webhook/${center.A.tenantId}`).send(body(A_SECRET, 'a_service', '1', txId)).expect(200)).body.error).toBe(0);
    const paid = (await http().get(`/api/payments?studentId=${center.A.studentId}`).set(as('A')).expect(200)).body;
    expect(JSON.stringify(paid)).toContain('150000');
  });

  it('Payme: the center key opens its route, any other key does not', async () => {
    await http().put('/api/billing/accounts/PAYME').set(as('A')).send({ merchantId: 'apaymemerchant', secret: A_PAYME_KEY }).expect(200);
    expect((await http().get('/api/billing/config').set(as('A')).expect(200)).body.paymeEnabled).toBe(true);
    const txId = (await link('A', 'payme').expect(201)).body.transactionId as string;
    const call = (key: string) =>
      http().post(`/api/billing/payme/webhook/${center.A.tenantId}`).set('Authorization', 'Basic ' + Buffer.from(`Paycom:${key}`).toString('base64'))
        .send({ id: 1, method: 'CheckPerformTransaction', params: { amount: 150000 * 100, account: { transaction_param: txId } } }).expect(200);
    expect((await call('wrong-key')).body.error.code).toBe(-32504);
    expect((await call(A_PAYME_KEY)).body.result).toEqual({ allow: true });

    // Removed: back to no Payme.
    await http().delete('/api/billing/accounts/PAYME').set(as('A')).expect(200);
    expect((await http().get('/api/billing/config').set(as('A')).expect(200)).body.paymeEnabled).toBe(false);
  });

  it('only admins manage the accounts', async () => {
    await http().post('/api/staff').set(as('A')).send({ email: `pay-m-${suffix}@test.uz`, fullName: 'Pay Manager', role: 'MANAGER', password: 'password12345' }).expect(201);
    const manager = (await http().post('/api/auth/login').send({ email: `pay-m-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/billing/accounts').set({ Authorization: `Bearer ${manager}` }).expect(403);
    await http().put('/api/billing/accounts/CLICK').set({ Authorization: `Bearer ${manager}` }).send({ merchantId: 'm', serviceId: 's', secret: 'x' }).expect(403);
  });
});
