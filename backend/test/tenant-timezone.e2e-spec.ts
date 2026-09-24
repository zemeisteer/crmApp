import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { tenants } from '../src/db/schema.js';
import { zonedDayBounds } from '../src/common/timezone.js';

// Follow-up queues use the center's own timezone (tenants.timezone), not a
// fixed UTC+5.
describe('Tenant timezone in admissions (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  const tz = 'Pacific/Kiritimati'; // UTC+14: its "today" rarely matches Tashkent's
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    const res = await http()
      .post('/api/auth/register')
      .send({ centerName: `TZ Kiri ${suffix}`, subdomain: `tzk-${suffix}`, email: `tzk-${suffix}@test.uz`, password: 'password123', fullName: 'Owner' })
      .expect(201);
    token = res.body.accessToken;
    await app.get<Database>(DB).update(tenants).set({ timezone: tz }).where(eq(tenants.id, res.body.tenant.id));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('buckets follow-ups by the end of the center\'s local day', async () => {
    const now = Date.now();
    const { endOfToday } = zonedDayBounds(new Date(now), tz);
    const laterToday = new Date(now + (endOfToday.getTime() - now) / 2).toISOString();
    const tomorrow = new Date(endOfToday.getTime() + 60 * 60_000).toISOString();

    const mk = async (fullName: string, phone: string, followUpAt: string) =>
      (await http().post('/api/leads').set('Authorization', `Bearer ${token}`).send({ fullName, phone, followUpAt }).expect(201)).body.id as string;
    const todayId = await mk('Later Today', '+998901230001', laterToday);
    const upcomingId = await mk('Tomorrow', '+998901230002', tomorrow);

    const ids = async (bucket: string) =>
      (await http().get(`/api/leads?followUp=${bucket}`).set('Authorization', `Bearer ${token}`).expect(200)).body.items.map((l: { id: string }) => l.id);
    expect(await ids('today')).toEqual([todayId]);
    expect(await ids('upcoming')).toEqual([upcomingId]);

    const summary = await http().get('/api/leads/follow-ups/summary').set('Authorization', `Bearer ${token}`).expect(200);
    expect(summary.body).toMatchObject({ today: 1, upcoming: 1, overdue: 0, timezone: tz });
  });
});
