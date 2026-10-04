import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { and, eq } from 'drizzle-orm';
import { generate as totp } from 'otplib';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { authHandoffCodes, organizationMemberships, users } from '../src/db/schema.js';

// One person, two centers, a different role in each: the chosen workspace
// must survive /me, refresh, 2FA and the handoff to the center's address,
// and stop working the moment the membership does.
describe('Workspace-aware sessions (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const email = `two-${suffix}@test.uz`;
  const password = 'password123';
  let tenantA: string;
  let tenantB: string;
  let tenantC: string;
  let userId: string;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  const registerCenter = async (tag: string, mail: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `WS ${tag} ${suffix}`, subdomain: `ws-${tag}-${suffix}`, email: mail, password, fullName: `Owner ${tag}` })
      .expect(201)).body;
  const login = async () => (await http().post('/api/auth/login').send({ email, password }).expect(201)).body;
  const selectB = async (session: { accessToken: string; refreshToken: string }) =>
    (await http().post('/api/auth/select-workspace').set(bearer(session.accessToken)).send({ tenantId: tenantB, refreshToken: session.refreshToken }).expect(201)).body;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);

    const a = await registerCenter('a', email); // OWNER of A
    tenantA = a.tenant.id;
    userId = a.user.id;
    tenantB = (await registerCenter('b', `ws-b-${suffix}@test.uz`)).tenant.id;
    tenantC = (await registerCenter('c', `ws-c-${suffix}@test.uz`)).tenant.id;
    // ...and a TEACHER in B.
    await db.insert(organizationMemberships).values({ userId, tenantId: tenantB, role: 'TEACHER', status: 'ACTIVE' });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the chosen workspace and its role across /me and refresh', async () => {
    const first = await login();
    expect(first.requiresWorkspaceSelection).toBe(true);
    expect(first.workspaces.map((w: { role: string }) => w.role).sort()).toEqual(['OWNER', 'TEACHER']);

    const b = await selectB(first);
    expect(typeof b.refreshToken).toBe('string');
    expect(b.user.role).toBe('TEACHER');
    expect(b.tenant.id).toBe(tenantB);

    const me = (await http().get('/api/auth/me').set(bearer(b.accessToken)).expect(200)).body;
    expect(me.tenant.id).toBe(tenantB);
    expect(me.user.role).toBe('TEACHER');

    // The provisional refresh token was rotated into the B session.
    await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);
    const refreshed = (await http().post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(201)).body;
    const meAfter = (await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(200)).body;
    expect(meAfter.tenant.id).toBe(tenantB); // not silently back to A
    expect(meAfter.user.role).toBe('TEACHER');

    // As a teacher in B the owner-only endpoints are closed; in A they are open.
    await http().get('/api/reports/director').set(bearer(refreshed.accessToken)).expect(403);
    const a = (await http().post('/api/auth/select-workspace').set(bearer(refreshed.accessToken)).send({ tenantId: tenantA }).expect(201)).body;
    expect(a.user.role).toBe('OWNER');
    await http().get('/api/reports/director').set(bearer(a.accessToken)).expect(200);
  });

  it('refuses a workspace the user does not belong to', async () => {
    const s = await login();
    await http().post('/api/auth/select-workspace').set(bearer(s.accessToken)).send({ tenantId: tenantC }).expect(401);
    await http().post('/api/auth/select-workspace').set(bearer(s.accessToken)).send({}).expect(400);
    await http().post('/api/auth/select-workspace').send({ tenantId: tenantA }).expect(401);
  });

  it('stops a suspended or removed membership at once: requests, /me and refresh', async () => {
    const b = await selectB(await login());
    await http().get('/api/groups').set(bearer(b.accessToken)).expect(200);

    const where = and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.tenantId, tenantB));
    await db.update(organizationMemberships).set({ status: 'SUSPENDED' }).where(where);
    await http().get('/api/groups').set(bearer(b.accessToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(b.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    // The session is gone, and B is no longer offered.
    await http().post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(401);
    const again = await login();
    expect(again.requiresWorkspaceSelection).toBe(false);
    expect(again.tenant.id).toBe(tenantA);
    await http().post('/api/auth/select-workspace').set(bearer(again.accessToken)).send({ tenantId: tenantB }).expect(401);

    // A role change applies on the next request, without a new token.
    await db.update(organizationMemberships).set({ status: 'ACTIVE', role: 'MANAGER' }).where(where);
    const b2 = await selectB(await login());
    expect(b2.user.role).toBe('MANAGER');
    await db.update(organizationMemberships).set({ role: 'TEACHER' }).where(where);
    await http().get('/api/reports/director').set(bearer(b2.accessToken)).expect(403);
    expect((await http().get('/api/auth/me').set(bearer(b2.accessToken)).expect(200)).body.user.role).toBe('TEACHER');
  });

  it('carries the workspace through the handoff with a refresh session; codes expire and are single-use', async () => {
    const b = await selectB(await login());
    const h = (await http().post('/api/auth/handoff').set(bearer(b.accessToken)).expect(201)).body;
    expect(h.subdomain).toBe(`ws-b-${suffix}`);

    const landed = (await http().post('/api/auth/handoff/exchange').send({ code: h.code }).expect(201)).body;
    expect(typeof landed.refreshToken).toBe('string');
    expect(landed.refreshToken).not.toBe(b.refreshToken);
    expect(landed.tenant.id).toBe(tenantB);
    expect(landed.user.role).toBe('TEACHER');
    await http().post('/api/auth/handoff/exchange').send({ code: h.code }).expect(401); // replay

    // The destination session refreshes on its own and stays in B.
    const r = (await http().post('/api/auth/refresh').send({ refreshToken: landed.refreshToken }).expect(201)).body;
    expect((await http().get('/api/auth/me').set(bearer(r.accessToken)).expect(200)).body.tenant.id).toBe(tenantB);

    // Expired code.
    const h2 = (await http().post('/api/auth/handoff').set(bearer(b.accessToken)).expect(201)).body;
    await db.update(authHandoffCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(authHandoffCodes.userId, userId));
    await http().post('/api/auth/handoff/exchange').send({ code: h2.code }).expect(401);

    // A code issued before the membership ended opens nothing.
    const h3 = (await http().post('/api/auth/handoff').set(bearer(b.accessToken)).expect(201)).body;
    const where = and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.tenantId, tenantB));
    await db.update(organizationMemberships).set({ status: 'SUSPENDED' }).where(where);
    await http().post('/api/auth/handoff/exchange').send({ code: h3.code }).expect(401);
    await db.update(organizationMemberships).set({ status: 'ACTIVE' }).where(where);
  });

  it('applies the same workspace rules after a 2FA login; the pending token opens nothing', async () => {
    const s = await login();
    const setup = (await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).expect(201)).body;
    await http().post('/api/auth/2fa/confirm').set(bearer(s.accessToken)).send({ code: await totp({ secret: setup.secret }) }).expect(201);

    const pending = (await http().post('/api/auth/login').send({ email, password }).expect(201)).body;
    expect(pending.twoFactorRequired).toBe(true);
    expect(pending.accessToken).toBeUndefined();
    await http().get('/api/groups').set(bearer(pending.pendingToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(pending.pendingToken)).expect(401);

    const done = (await http().post('/api/auth/2fa/verify-login').send({ pendingToken: pending.pendingToken, code: await totp({ secret: setup.secret }) }).expect(201)).body;
    expect(done.requiresWorkspaceSelection).toBe(true);
    expect(done.workspaces).toHaveLength(2);
    const b = await selectB(done);
    expect(b.user.role).toBe('TEACHER'); // membership role, not the global OWNER
    const r = (await http().post('/api/auth/refresh').send({ refreshToken: b.refreshToken }).expect(201)).body;
    expect((await http().get('/api/auth/me').set(bearer(r.accessToken)).expect(200)).body.tenant.id).toBe(tenantB);

    await db.update(users).set({ twoFactorEnabled: false, twoFactorSecret: null }).where(eq(users.id, userId));
  });
});
