import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, tenants, users } from '../src/db/schema.js';

// SMS goes through the platform's provider account. A plan says whether SMS
// is part of it; a center switches it on or off and never sees or sets a
// provider, token or sender.
describe('SMS by plan (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PLAN = `SMSLESS_${suffix}`;

  let sa: string, owner: string, tenantId: string, planId: string;

  const testSms = async () =>
    (await http().post('/api/notifications/test').set(bearer(owner)).send({ channel: 'SMS', recipient: '+998901234567', content: 'Sinov' }).expect(201)).body;
  const settings = async () => (await http().get('/api/notifications/settings').set(bearer(owner)).expect(200)).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const email = `sms-sa-${suffix}@test.uz`;
    const reg = (await http().post('/api/auth/register').send({ centerName: `SMS root ${suffix}`, subdomain: `sms-root-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, reg.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, reg.user.id));
    sa = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
    const center = (await http().post('/api/auth/register').send({ centerName: `SMS center ${suffix}`, subdomain: `sms-c-${suffix}`, email: `sms-o-${suffix}@test.uz`, password: 'password123', fullName: 'Center Owner' }).expect(201)).body;
    owner = center.accessToken;
    tenantId = center.tenant.id;
    // A plan of this run only, so no other test's center loses SMS.
    planId = (await http().post('/api/plans').set(bearer(sa)).send({ key: PLAN, name: `No SMS ${suffix}`, price: 1000, smsIncluded: false }).expect(201)).body.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a center sees whether SMS is in its plan and on; no provider, token or sender', async () => {
    const s = await settings();
    expect(s.sms).toEqual({ includedInPlan: true, enabled: true, providerReady: expect.any(Boolean) });
    for (const field of ['smsApiToken', 'smsProvider', 'smsSender', 'hasSmsApiToken']) expect(s).not.toHaveProperty(field);
  });

  it('a center cannot set a provider, token or sender any more', async () => {
    await http().patch('/api/notifications/settings').set(bearer(owner)).send({ smsApiToken: 'stolen-token', smsProvider: 'playmobile', smsSender: 'FAKE' }).expect(200);
    const [row] = await db.select({ token: tenants.smsApiToken, provider: tenants.smsProvider, sender: tenants.smsSender }).from(tenants).where(eq(tenants.id, tenantId));
    expect(row).toEqual({ token: null, provider: 'eskiz', sender: '4546' });
  });

  it('switched off by the center: no SMS goes out, and the reminder preview offers none', async () => {
    await http().patch('/api/notifications/settings').set(bearer(owner)).send({ smsEnabled: false }).expect(200);
    expect((await settings()).sms.enabled).toBe(false);
    expect(await testSms()).toMatchObject({ status: 'FAILED', errorMessage: "SMS markaz sozlamalarida o'chirilgan" });
    const preview = (await http().get('/api/notifications/debtor-reminders/preview').set(bearer(owner)).expect(200)).body;
    expect(preview.channels.sms).toBe(false);

    await http().patch('/api/notifications/settings').set(bearer(owner)).send({ smsEnabled: true }).expect(200);
    // Back on: outside production a missing platform token is the sandbox, which "sends".
    expect((await testSms()).status).toBe('SENT');
  });

  it('a plan without SMS: the center is told so and nothing is sent, whatever its own switch says', async () => {
    await http().patch(`/api/platform/subscriptions/${tenantId}`).set(bearer(sa)).send({ plan: PLAN }).expect(200);
    const s = await settings();
    expect(s.sms.includedInPlan).toBe(false);
    expect(s.smsEnabled).toBe(true);
    expect(await testSms()).toMatchObject({ status: 'FAILED', errorMessage: 'SMS tarifingizga kiritilmagan' });

    // The platform admin puts SMS into the plan: it works again.
    const plan = (await http().patch(`/api/plans/${planId}`).set(bearer(sa)).send({ smsIncluded: true }).expect(200)).body;
    expect(plan.smsIncluded).toBe(true);
    expect((await settings()).sms.includedInPlan).toBe(true);
    expect((await testSms()).status).toBe('SENT');
  });

  it('only the platform admin decides what a plan includes', async () => {
    await http().patch(`/api/plans/${planId}`).set(bearer(owner)).send({ smsIncluded: false }).expect(403);
  });
});
