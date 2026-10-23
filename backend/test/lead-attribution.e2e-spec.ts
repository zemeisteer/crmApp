import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { leads } from '../src/db/schema.js';

// An application from the center's site: the ad network its link names is
// the lead's source (counted in the source reports), the tags stay on the
// lead's timeline; a plain visit is WEBSITE.
describe('Site applications: where they came from (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  let tenantId: string;
  const sub = `la${tail}`;
  const apply = (n: number, extra: Record<string, unknown> = {}) =>
    http().post(`/api/tenants/by-subdomain/${sub}/apply`).send({ fullName: `LA ${n}`, phone: `+9989${tail}${String(n).padStart(3, '0')}`, consent: true, formStartedAt: Date.now() - 10_000, ...extra });
  const sourceOf = async (n: number) =>
    (await db.select({ source: leads.source }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.fullName, `LA ${n}`))))[0]?.source;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    tenantId = (await http().post('/api/auth/register').send({ centerName: `LA ${suffix}`, subdomain: sub, email: `la-${suffix}@test.uz`, password: 'password123', fullName: 'LA Owner' }).expect(201)).body.tenant.id;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('instagram, telegram and paid networks become the source; a plain visit is WEBSITE', async () => {
    await apply(1, { utmSource: 'Instagram', utmCampaign: 'kuz-2026' }).expect(201);
    await apply(2, { utmSource: 'tg' }).expect(201);
    await apply(3, { utmSource: 'facebook', utmMedium: 'cpc' }).expect(201);
    await apply(4).expect(201);
    expect([await sourceOf(1), await sourceOf(2), await sourceOf(3), await sourceOf(4)]).toEqual(['INSTAGRAM', 'TELEGRAM', 'ADVERTISEMENT', 'WEBSITE']);
  });
});
