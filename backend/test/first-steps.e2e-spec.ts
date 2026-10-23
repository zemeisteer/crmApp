import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { tenants, users } from '../src/db/schema.js';

// The dashboard's "first steps": read from what the center has done, so
// each real action ticks its step; only the owner and admins see it.
describe('First steps checklist (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('starts empty; adding students, a colleague, Telegram and the site ticks those steps', async () => {
    const reg = (await http().post('/api/auth/register').send({ centerName: `FS ${suffix}`, subdomain: `fs${tail}`, email: `fs-${suffix}@test.uz`, password: 'password123', fullName: 'FS Owner' }).expect(201)).body;
    const owner = reg.accessToken as string;
    const done = async () => Object.fromEntries(((await http().get('/api/onboarding/checklist').set(bearer(owner)).expect(200)).body.items as Array<{ key: string; done: boolean }>).map((i) => [i.key, i.done]));

    expect(await done()).toEqual({ group: false, students: false, attendance: false, payment: false, team: false, telegram: false, site: false });

    await http().post('/api/students').set(bearer(owner)).send({ fullName: 'FS Student', phone: `+99893${tail}11` }).expect(201);
    await http().post('/api/staff').set(bearer(owner)).send({ email: `fs-staff-${suffix}@test.uz`, fullName: 'FS Staff', role: 'MANAGER', password: 'password12345' }).expect(201);
    await db.update(users).set({ telegramChatId: `9${tail}` }).where(eq(users.id, reg.user.id));
    await db.update(tenants).set({ siteContent: JSON.stringify({ about: 'Biz haqimizda' }) }).where(eq(tenants.id, reg.tenant.id));

    expect(await done()).toMatchObject({ students: true, team: true, telegram: true, site: true, group: false, payment: false });
    const body = (await http().get('/api/onboarding/checklist').set(bearer(owner)).expect(200)).body;
    expect([body.done, body.total]).toEqual([4, 7]);

    // Staff who do not run the center do not get it.
    const manager = (await http().post('/api/auth/login').send({ email: `fs-staff-${suffix}@test.uz`, password: 'password12345' }).expect(201)).body.accessToken;
    await http().get('/api/onboarding/checklist').set(bearer(manager)).expect(403);
  });
});
