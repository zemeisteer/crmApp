import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { tenants } from '../src/db/schema.js';

// Availability and abuse limits of the public application form. Kept in its
// own file so it has a fresh per-IP throttle budget (5 requests / minute).
describe('Public application form limits (e2e)', () => {
  let app: INestApplication<App>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  const body = (n: number) => ({ fullName: `Limit ${n}`, phone: `+99890556${String(n).padStart(4, '0')}`, consent: true, formStartedAt: Date.now() - 10_000 });

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects unknown and suspended centers with 404, then rate-limits the 6th request', async () => {
    await http().post(`/api/tenants/by-subdomain/no-such-center-${suffix}/apply`).send(body(1)).expect(404);

    const open = `lim-${suffix}`;
    const suspended = `lim-s-${suffix}`;
    for (const sub of [open, suspended]) {
      await http().post('/api/auth/register')
        .send({ centerName: `Lim ${sub}`, subdomain: sub, email: `${sub}@test.uz`, password: 'password123', fullName: 'Owner' })
        .expect(201);
    }
    await app.get<Database>(DB).update(tenants).set({ status: 'SUSPENDED' }).where(eq(tenants.subdomain, suspended));
    await http().post(`/api/tenants/by-subdomain/${suspended}/apply`).send(body(2)).expect(404);

    // Requests 3-5 are within the limit; the 6th in the same minute is not.
    for (const n of [3, 4, 5]) await http().post(`/api/tenants/by-subdomain/${open}/apply`).send(body(n)).expect(201);
    await http().post(`/api/tenants/by-subdomain/${open}/apply`).send(body(6)).expect(429);
  });
});
