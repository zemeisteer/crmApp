import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, plans, users } from '../src/db/schema.js';

// Tariff feature lists are kept per language (L-02): the platform admin
// writes the Uzbek list and, optionally, the Russian and English ones; the
// public list carries all three so the site shows the visitor's language.
describe('Tariff feature lists per language (e2e)', () => {
  let app: NestExpressApplication;
  let sa: string;
  const suffix = Date.now();
  const key = `LANG${suffix}`;
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app, process.env);
    await app.init();
    const email = `plans-sa-${suffix}@test.uz`;
    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Plans ${suffix}`, subdomain: `plans-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' })
      .expect(201)).body;
    const db = app.get<Database>(DB);
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, reg.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, reg.user.id));
    sa = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;
  });

  afterAll(async () => {
    await app?.get<Database>(DB).delete(plans).where(eq(plans.key, key));
    await app?.close();
  });

  it('stores the Russian and English lists and hands them to the public site', async () => {
    const created = (await http().post('/api/plans').set(bearer(sa))
      .send({ key, name: 'Lang', price: 1000, features: 'Bir\nIkki', featuresRu: 'Один\nДва', featuresEn: 'One\nTwo' })
      .expect(201)).body;
    expect(created).toMatchObject({ features: 'Bir\nIkki', featuresRu: 'Один\nДва', featuresEn: 'One\nTwo' });

    const pub = (await http().get('/api/plans/public').expect(200)).body as Array<{ key: string; featuresRu: string; featuresEn: string }>;
    expect(pub.find((p) => p.key === key)).toMatchObject({ featuresRu: 'Один\nДва', featuresEn: 'One\nTwo' });

    // Clearing a translation is allowed: the site then falls back to Uzbek.
    const upd = (await http().patch(`/api/plans/${created.id}`).set(bearer(sa)).send({ featuresEn: '' }).expect(200)).body;
    expect(upd).toMatchObject({ features: 'Bir\nIkki', featuresRu: 'Один\nДва', featuresEn: '' });

    await http().patch(`/api/plans/${created.id}`).set(bearer(sa)).send({ featuresRu: 42 }).expect(400);
  });

  it('only the platform admin edits them', async () => {
    const owner = (await http().post('/api/auth/register')
      .send({ centerName: `Plans O ${suffix}`, subdomain: `plans-o-${suffix}`, email: `plans-o-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201)).body.accessToken;
    const [p] = await app.get<Database>(DB).select({ id: plans.id }).from(plans).where(eq(plans.key, key));
    await http().patch(`/api/plans/${p.id}`).set(bearer(owner)).send({ featuresRu: 'x' }).expect(403);
  });
});
