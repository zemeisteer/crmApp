import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Database } from '../src/db/db.module.js';
import { plans, tenants, users } from '../src/db/schema.js';
import { clearFlagCache } from '../src/feature-flags/flags.js';

// IP telephony costs the platform money per use, so it is OFF until someone
// decides: the center's plan ticks it, or the platform admin turns the
// "telephony" switch on for that one center. Another center stays off.
describe('Who has IP telephony (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  let admin: string;

  const register = async (k: string) => {
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Gate ${k} ${suffix}`, subdomain: `gate-${k}-${tail}`, email: `gate-${k}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${k}` })
      .expect(201)).body;
    return { token: reg.accessToken as string, id: (reg.tenant?.id ?? reg.user.tenantId) as string };
  };
  const save = (token: string) => http().put('/api/telephony/settings').set(bearer(token)).send({ provider: 'MOCK', apiKey: 'gatekey1234', apiSecret: 'gate-secret' });
  const entitled = async (token: string) => (await http().get('/api/auth/me').set(bearer(token)).expect(200)).body.tenant.entitlements.TELEPHONY === true;

  beforeAll(async () => {
    process.env.SETTINGS_KEY = randomBytes(32).toString('base64');
    const mod: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = mod.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    const email = `gate-admin-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `Gate admin ${suffix}`, subdomain: `gate-adm-${tail}`, email, password: 'password123', fullName: 'Gate Admin' }).expect(201);
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.email, email));
    admin = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
  }, 120_000);

  afterEach(() => clearFlagCache());
  afterAll(async () => { await app?.close(); });

  it('a new center has no telephony: settings refused, the menu item hidden', async () => {
    const c = await register('none');
    expect((await save(c.token).expect(403)).body.code).toBe('PLAN_FEATURE');
    expect(await entitled(c.token)).toBe(false);
  });

  it('the platform admin turns it on for one center; another stays off; turned off again, it is gone', async () => {
    const on = await register('on');
    const off = await register('off');
    await http().put(`/api/feature-flags/telephony/tenants/${on.id}`).set(bearer(on.token)).send({ enabled: true }).expect(403);
    await http().put(`/api/feature-flags/telephony/tenants/${on.id}`).set(bearer(admin)).send({ enabled: true }).expect(200);
    clearFlagCache();
    expect(await entitled(on.token)).toBe(true);
    await save(on.token).expect(200);
    expect(await entitled(off.token)).toBe(false);
    await save(off.token).expect(403);

    const view = (await http().get('/api/feature-flags/overview').set(bearer(admin)).expect(200)).body as Array<{ key: string; overrides: Array<{ tenantId: string; enabled: boolean }> }>;
    expect(view.find((f) => f.key === 'telephony')?.overrides).toEqual(expect.arrayContaining([expect.objectContaining({ tenantId: on.id, enabled: true })]));

    await http().delete(`/api/feature-flags/telephony/tenants/${on.id}`).set(bearer(admin)).expect(200);
    clearFlagCache();
    expect(await entitled(on.token)).toBe(false);
    expect((await save(on.token).expect(403)).body.code).toBe('PLAN_FEATURE');
  });

  it("a plan that ticks it gives it to that plan's centers; one that leaves it out does not", async () => {
    const c = await register('plan');
    const key = `gate-plan-${tail}`;
    await db.insert(plans).values({ key, name: 'Gate plan', price: 100_000, entitlements: { TELEPHONY: true } });
    try {
      await db.update(tenants).set({ plan: key }).where(eq(tenants.id, c.id));
      expect(await entitled(c.token)).toBe(true);
      await save(c.token).expect(200);
      await db.update(plans).set({ entitlements: {} }).where(eq(plans.key, key));
      expect(await entitled(c.token)).toBe(false);
    } finally {
      await db.update(tenants).set({ plan: 'STARTER' }).where(eq(tenants.id, c.id)).catch(() => undefined);
      await db.delete(plans).where(eq(plans.key, key));
    }
  });
});
