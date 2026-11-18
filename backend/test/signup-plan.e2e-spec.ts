import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { plans, tenants } from '../src/db/schema.js';

// The plan picked on the pricing page ("Shu tarif bilan boshlash") is the
// plan the new center's free trial runs on; anything unknown or switched
// off falls back to STARTER.
describe('Sign-up keeps the chosen plan (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-6);
  const paid = `SPPAID${tail}`;
  const hidden = `SPHIDDEN${tail}`;
  const http = () => request(app.getHttpServer() as App);
  const register = (key: string, plan?: string) =>
    http()
      .post('/api/auth/register')
      .send({ centerName: `SP ${key} ${suffix}`, subdomain: `sp-${key}-${tail}`, email: `sp-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}`, ...(plan === undefined ? {} : { plan }) })
      .expect(201);
  const stored = async (id: string) => (await db.query.tenants.findFirst({ where: eq(tenants.id, id) }))!;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    await db.insert(plans).values([
      { key: paid, name: 'Paid test plan', price: 300_000, active: true },
      { key: hidden, name: 'Retired test plan', price: 500_000, active: false },
    ]);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the chosen plan is stored on the new center, which is on its 7-day trial', async () => {
    const res = await register('chosen', paid.toLowerCase());
    expect(res.body.tenant.plan).toBe(paid);
    const t = await stored(res.body.tenant.id);
    expect([t.plan, t.status]).toEqual([paid, 'TRIAL']);
    const days = (t.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('no plan, an unknown one or an inactive one: STARTER', async () => {
    for (const [key, plan] of [['none', undefined], ['unknown', 'NO-SUCH-PLAN'], ['inactive', hidden]] as const) {
      const res = await register(key, plan);
      expect((await stored(res.body.tenant.id)).plan).toBe('STARTER');
    }
  });
});
