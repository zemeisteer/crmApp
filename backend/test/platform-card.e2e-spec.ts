import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { organizationMemberships, platformSubscriptions, tenants, users } from '../src/db/schema.js';
import { TelegramService } from '../src/telegram/telegram.service.js';

// A center pays the platform by card transfer: the platform's card on the
// plans page, a receipt sent for a tariff and month, and only the platform
// admin's "confirm" records the month paid (the center's paid time grows),
// once; a rejection says why.
describe('Paying the platform by card (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  let owner: Record<string, string>;
  let sa: Record<string, string>;
  let tenantId: string;
  const told: string[] = [];
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

  beforeAll(async () => {
    process.env.PLATFORM_CARD_NUMBER = '';
    process.env.PLATFORM_CARD_HOLDER = '';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const tg = app.get(TelegramService);
    tg.sendMessage = (async (_c: string, text: string) => {
      told.push(text);
      return 1;
    }) as typeof tg.sendMessage;

    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `PCard ${suffix}`, subdomain: `pcard-${suffix}`, email: `pcard-${suffix}@test.uz`, password: 'password123', fullName: 'PCard Owner' })
      .expect(201)).body;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    tenantId = reg.tenant?.id ?? reg.user.tenantId;
    await db.update(users).set({ telegramChatId: `2${String(suffix).slice(-8)}` }).where(eq(users.id, reg.user.id));

    const email = `pcard-sa-${suffix}@test.uz`;
    const s = (await http().post('/api/auth/register').send({ centerName: `PSa ${suffix}`, subdomain: `psa-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN', telegramChatId: `1${String(suffix).slice(-8)}` }).where(eq(users.id, s.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, s.user.id));
    sa = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken}` };
  });

  afterAll(async () => {
    delete process.env.PLATFORM_CARD_NUMBER;
    delete process.env.PLATFORM_CARD_HOLDER;
    await app?.close();
  });

  const send = (forMonth: string, plan = 'STANDARD', file = true) => {
    const r = http().post('/api/platform-billing/card').set(owner).field('plan', plan).field('forMonth', forMonth);
    return file ? r.attach('file', png, { filename: 'chek.png', contentType: 'image/png' }) : r;
  };

  it('no card set: nothing to pay to', async () => {
    expect((await http().get('/api/platform-billing/card').set(owner).expect(200)).body.card).toBeNull();
    await send('2026-11').expect(400);
  });

  it('the center sends a receipt; the platform admin hears of it and confirms it into a paid month, once', async () => {
    process.env.PLATFORM_CARD_NUMBER = '9860 1234 5678 9012';
    process.env.PLATFORM_CARD_HOLDER = 'Platform Egasi';
    expect((await http().get('/api/platform-billing/card').set(owner).expect(200)).body.card).toEqual({ number: '9860 1234 5678 9012', holder: 'Platform Egasi' });
    await send('2026-11', 'STANDARD', false).expect(400);
    await send('2026-11', 'NO_SUCH_PLAN').expect(404);
    const claim = (await send('2026-11').expect(201)).body;
    expect(claim).toMatchObject({ status: 'PENDING', plan: 'STANDARD', forMonth: '2026-11' });
    expect(claim.amount).toBeGreaterThan(0);
    await send('2026-11').expect(409); // one waiting receipt per month
    await new Promise((r) => setTimeout(r, 200));
    expect(told.at(-1)).toContain(`PCard ${suffix}`);

    // The center itself cannot confirm; the platform admin sees it with its picture.
    await http().post(`/api/platform/card-claims/${claim.id}/confirm`).set(owner).expect(403);
    const list = (await http().get('/api/platform/card-claims?status=PENDING').set(sa).expect(200)).body;
    expect(list.items.find((c: { id: string }) => c.id === claim.id)).toMatchObject({ centerName: `PCard ${suffix}` });
    await http().get(`/api/platform/card-claims/${claim.id}/receipt`).set(sa).expect(200);

    const before = (await db.select().from(tenants).where(eq(tenants.id, tenantId)))[0].paidUntil;
    expect(before).toBeNull();
    const done = (await http().post(`/api/platform/card-claims/${claim.id}/confirm`).set(sa).expect(201)).body;
    expect(done.status).toBe('CONFIRMED');
    await http().post(`/api/platform/card-claims/${claim.id}/confirm`).set(sa).expect(409);
    const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(t.paidUntil).not.toBeNull();
    expect(t.status).toBe('ACTIVE');
    const subs = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId));
    expect(subs.filter((s) => s.status === 'PAID')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 200));
    expect(told.some((m) => m.includes('tasdiqlandi'))).toBe(true);

    // The month is paid: no second receipt for it.
    await send('2026-11').expect(409);
  });

  it('a rejected receipt says why and pays nothing', async () => {
    const claim = (await send('2026-12').expect(201)).body;
    await http().post(`/api/platform/card-claims/${claim.id}/reject`).set(sa).send({ reason: '' }).expect(400);
    await http().post(`/api/platform/card-claims/${claim.id}/reject`).set(sa).send({ reason: 'Pul kelmadi' }).expect(201);
    const mine = (await http().get('/api/platform-billing/card').set(owner).expect(200)).body.claims;
    expect(mine.find((c: { id: string }) => c.id === claim.id)).toMatchObject({ status: 'REJECTED', rejectReason: 'Pul kelmadi' });
    const subs = await db.select().from(platformSubscriptions).where(eq(platformSubscriptions.tenantId, tenantId));
    expect(subs.find((s) => s.forMonth === '2026-12')).toBeUndefined();
    // After a rejection the center may send a new receipt for that month.
    await send('2026-12').expect(201);
  });

  it('a center whose trial is over can still pay by card', async () => {
    await db.update(tenants).set({ status: 'TRIAL', trialEndsAt: new Date('2020-01-01') }).where(eq(tenants.id, tenantId));
    await http().get('/api/platform-billing/card').set(owner).expect(200);
    await send('2027-01').expect(201);
  });
});
