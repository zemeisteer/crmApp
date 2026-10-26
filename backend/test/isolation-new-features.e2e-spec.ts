import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { messageClassifications, organizationMemberships, signals, users } from '../src/db/schema.js';

// Two independent centers and every role, against the newer features: card
// receipts (student -> center, center -> platform), signals, message
// classification, hiring and payment accounts. Nothing of one center is
// reachable from the other, and staff without the right are refused - by
// direct API calls, not only by what the pages show.
describe('Tenant isolation and roles on the newer features (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-7);
  const http = () => request(app.getHttpServer());
  type Center = { owner: Record<string, string>; tenantId: string; studentId: string; teacher: Record<string, string>; manager: Record<string, string>; reception: Record<string, string> };
  const c: Record<'A' | 'B', Center> = {} as never;
  let sa: Record<string, string>;
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    Object.assign(process.env, { PLATFORM_CARD_NUMBER: '9860 1111 2222 3333', PLATFORM_CARD_HOLDER: 'Iso Test' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);

    const staff = async (owner: Record<string, string>, role: string, k: string) => {
      const email = `iso-${k}-${role.toLowerCase()}-${suffix}@test.uz`;
      await http().post('/api/staff').set(owner).send({ email, fullName: `Iso ${role}`, role, password: 'password12345' }).expect(201);
      return { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email, password: 'password12345' }).expect(201)).body.accessToken}` };
    };
    for (const k of ['A', 'B'] as const) {
      const reg = (await http().post('/api/auth/register')
        .send({ centerName: `Iso ${k} ${suffix}`, subdomain: `iso-${k.toLowerCase()}-${suffix}`, email: `iso-${k}-${suffix}@test.uz`, password: 'password123', fullName: `Iso Owner ${k}` })
        .expect(201)).body;
      const owner = { Authorization: `Bearer ${reg.accessToken}` };
      const phone = `+9989${k === 'A' ? 1 : 2}${tail}`;
      const studentId = (await http().post('/api/students').set(owner).send({ fullName: `Iso Student ${k}`, phone }).expect(201)).body.id;
      c[k] = { owner, tenantId: reg.tenant?.id ?? reg.user.tenantId, studentId, teacher: await staff(owner, 'TEACHER', k), manager: await staff(owner, 'MANAGER', k), reception: await staff(owner, 'RECEPTIONIST', k) };
    }

    const email = `iso-sa-${suffix}@test.uz`;
    const s = (await http().post('/api/auth/register').send({ centerName: `IsoSa ${suffix}`, subdomain: `iso-sa-${suffix}`, email, password: 'password123', fullName: 'Iso Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, s.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, s.user.id));
    sa = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken}` };

    // Center A's records of each kind.
    await http().put('/api/card-payments/card').set(c.A.owner).send({ cardNumber: '8600 1234 5678 9012', cardHolder: 'Iso A' }).expect(200);
    const { pin } = (await http().post(`/api/students/${c.A.studentId}/portal-pin`).set(c.A.owner).expect(201)).body;
    const portal = { Authorization: `Bearer ${(await http().post('/api/portal/auth/phone/verify').send({ phone: `+99891${tail}`, pin }).expect(201)).body.accessToken}` };
    const claim = (await http().post('/api/portal/card-payment').set(portal).field('amount', '100000').attach('file', png, { filename: 'c.png', contentType: 'image/png' }).expect(201)).body;
    ids.claim = claim.id;
    ids.claimFile = claim.receiptFile;
    ids.platformClaim = (await http().post('/api/platform-billing/card').set(c.A.owner).field('plan', 'STANDARD').attach('file', png, { filename: 'p.png', contentType: 'image/png' }).expect(201)).body.id;
    ids.candidate = (await http().post('/api/hiring/candidates').set(c.A.owner).send({ fullName: 'Iso Nomzod', phone: `+99893${tail}` }).expect(201)).body.id;
    const [sig] = await db.insert(signals).values({ tenantId: c.A.tenantId, rule: 'ABSENCE_STREAK', subjectType: 'student', subjectId: c.A.studentId, key: 'iso', reason: 'iso', facts: {}, action: 'NOTIFIED_MANAGERS' }).returning();
    ids.signal = sig.id;
    const [cls] = await db.insert(messageClassifications).values({ tenantId: c.A.tenantId, source: 'test', inputText: 'iso', options: {}, provider: 't', modelVersion: 't', status: 'SUGGESTED' }).returning();
    ids.classification = cls.id;
  });

  afterAll(async () => {
    delete process.env.PLATFORM_CARD_NUMBER;
    delete process.env.PLATFORM_CARD_HOLDER;
    await app?.close();
  });

  it("center B's owner reaches none of center A's records", async () => {
    const B = c.B.owner;
    expect((await http().get('/api/card-payments/claims').set(B).expect(200)).body.items.some((x: { id: string }) => x.id === ids.claim)).toBe(false);
    await http().post(`/api/card-payments/claims/${ids.claim}/confirm`).set(B).send({}).expect(404);
    await http().post(`/api/card-payments/claims/${ids.claim}/reject`).set(B).send({ reason: 'x' }).expect(404);
    expect((await http().post('/api/files/sign').set(B).send({ names: [ids.claimFile] }).expect(201)).body).toEqual({});
    expect((await http().get('/api/platform-billing/card').set(B).expect(200)).body.claims).toEqual([]);
    await http().get(`/api/hiring/candidates/${ids.candidate}`).set(B).expect(404);
    await http().patch(`/api/hiring/candidates/${ids.candidate}`).set(B).send({ notes: 'x' }).expect(404);
    await http().post(`/api/hiring/candidates/${ids.candidate}/hire`).set(B).expect(404);
    await http().delete(`/api/hiring/candidates/${ids.candidate}`).set(B).expect(404);
    expect((await http().get('/api/hiring/candidates').set(B).expect(200)).body.items).toEqual([]);
    await http().patch(`/api/signals/${ids.signal}`).set(B).send({ status: 'DONE' }).expect(404);
    expect((await http().get('/api/signals').set(B).expect(200)).body.items).toEqual([]);
    await http().patch(`/api/classifications/${ids.classification}`).set(B).send({ finalLabel: 'other' }).expect(404);
    expect((await http().get('/api/classifications').set(B).expect(200)).body.items).toEqual([]);
    // Payment accounts and the card are per center.
    expect((await http().get('/api/card-payments/card').set(B).expect(200)).body.card).toBeNull();
    expect((await http().get('/api/billing/accounts').set(B).expect(200)).body.click.connected).toBe(false);
    // Platform receipts are the platform admin's only.
    await http().get(`/api/platform/card-claims/${ids.platformClaim}/receipt`).set(B).expect(403);
    await http().post(`/api/platform/card-claims/${ids.platformClaim}/confirm`).set(c.A.owner).expect(403);
    await http().get('/api/platform/card-claims').set(sa).expect(200);
  });

  it('staff without the right are refused by the API', async () => {
    const { teacher, manager, reception } = c.A;
    // Teachers: no money, no hiring, no signals, no classification review.
    for (const [m, p] of [
      ['get', '/api/card-payments/claims'],
      ['get', '/api/signals'],
      ['get', '/api/hiring/candidates'],
      ['get', '/api/classifications'],
      ['get', '/api/billing/accounts'],
      ['get', '/api/platform-billing/card'],
    ] as const) await http()[m](p).set(teacher).expect(403);
    await http().post(`/api/card-payments/claims/${ids.claim}/confirm`).set(teacher).send({}).expect(403);
    await http().put('/api/card-payments/card').set(teacher).send({ cardNumber: '', cardHolder: '' }).expect(403);
    // Managers and reception see payments but do not take them, nor set the card or accounts.
    await http().get('/api/card-payments/claims').set(manager).expect(200);
    await http().post(`/api/card-payments/claims/${ids.claim}/confirm`).set(manager).send({}).expect(403);
    await http().post(`/api/card-payments/claims/${ids.claim}/confirm`).set(reception).send({}).expect(403);
    await http().put('/api/card-payments/card').set(manager).send({ cardNumber: '', cardHolder: '' }).expect(403);
    await http().put('/api/billing/accounts/CLICK').set(manager).send({ merchantId: 'm', serviceId: 's', secret: 'x' }).expect(403);
    await http().get('/api/classifications').set(manager).expect(403);
    await http().post(`/api/hiring/candidates/${ids.candidate}/hire`).set(manager).expect(403);
    await http().get('/api/hiring/candidates').set(reception).expect(403);
    // Nobody in a center reaches the platform admin's pages.
    for (const who of [teacher, manager, reception, c.A.owner]) {
      await http().get('/api/platform/card-claims').set(who).expect(403);
      await http().get('/api/platform/subscriptions').set(who).expect(403);
    }
    // No token at all.
    await http().get('/api/signals').expect(401);
    await http().get(`/api/platform/card-claims/${ids.platformClaim}/receipt`).expect(401);
  });
});
