import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { generate as totp } from 'otplib';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { organizationMemberships, sessions, users } from '../src/db/schema.js';

// A member removed from a center stays out of it - through every door: the
// tokens they already hold, refresh, a new login, choosing the workspace, a
// handoff code issued earlier - until someone deliberately adds them again.
// The removal goes through the real staff endpoint.
describe('Access after a member is removed (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  const http = () => request(app.getHttpServer());
  const suffix = Date.now();
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const password = 'password123';
  let ownerA: string;
  let ownerB: string;
  let tenantA: string;
  let tenantB: string;

  const register = async (tag: string) =>
    (await http().post('/api/auth/register')
      .send({ centerName: `Rm ${tag} ${suffix}`, subdomain: `rm-${tag}-${suffix}`, email: `rm-${tag}-${suffix}@test.uz`, password, fullName: `Owner ${tag}` })
      .expect(201)).body;
  const addStaff = async (owner: string, email: string, role = 'MANAGER') =>
    (await http().post('/api/staff').set(bearer(owner)).send({ fullName: `Staff ${email}`, email, password, role }).expect(201)).body;
  const login = (email: string, pw = password) => http().post('/api/auth/login').send({ email, password: pw });
  const membership = async (userId: string, tenantId: string) =>
    (await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.tenantId, tenantId))))[0];

  // Every way back into `tenantId` with what the person held before.
  async function expectLockedOut(s: { accessToken: string; refreshToken: string }, email: string, tenantId: string, handoffCode?: string) {
    await http().get('/api/groups').set(bearer(s.accessToken)).expect(401);
    await http().get('/api/students').set(bearer(s.accessToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(s.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);
    await http().post('/api/auth/select-workspace').set(bearer(s.accessToken)).send({ tenantId, refreshToken: s.refreshToken }).expect(401);
    await http().post('/api/auth/handoff').set(bearer(s.accessToken)).expect(401);
    if (handoffCode) await http().post('/api/auth/handoff/exchange').send({ code: handoffCode }).expect(401);
    const again = await login(email);
    if (again.status === 201) {
      // Signed in to another center: this one is not offered and cannot be chosen.
      expect(again.body.tenant?.id).not.toBe(tenantId);
      expect((again.body.workspaces ?? []).map((w: { tenantId: string }) => w.tenantId)).not.toContain(tenantId);
      await http().post('/api/auth/select-workspace').set(bearer(again.body.accessToken)).send({ tenantId }).expect(401);
    } else {
      expect(again.status).toBe(401);
    }
    return again;
  }

  beforeAll(async () => {
    // This suite signs in far more often than the login rate limit allows
    // from one address; the rate limit is not what is being tested here.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get<Database>(DB);
    const a = await register('a');
    const b = await register('b');
    ownerA = a.accessToken;
    tenantA = a.tenant.id;
    ownerB = b.accessToken;
    tenantB = b.tenant.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('removing a member with a single membership closes every way back in', async () => {
    const email = `rm-solo-${suffix}@test.uz`;
    const staff = await addStaff(ownerA, email);
    // Exactly one membership, and the legacy columns point at this center.
    expect(await db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, staff.id))).toHaveLength(1);
    expect((await db.select().from(users).where(eq(users.id, staff.id)))[0]).toMatchObject({ tenantId: tenantA, role: 'MANAGER' });

    const s = (await login(email).expect(201)).body;
    expect(s.tenant.id).toBe(tenantA);
    await http().get('/api/groups').set(bearer(s.accessToken)).expect(200);
    const second = (await login(email).expect(201)).body; // another device
    const handoff = (await http().post('/api/auth/handoff').set(bearer(s.accessToken)).expect(201)).body.code as string;

    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(200);

    await expectLockedOut(s, email, tenantA, handoff);
    await expectLockedOut(second, email, tenantA);
    expect((await login(email)).status).toBe(401);

    // What is left behind: a tombstone, no sessions, no listing.
    expect(await membership(staff.id, tenantA)).toMatchObject({ status: 'SUSPENDED', role: 'MANAGER' });
    expect((await membership(staff.id, tenantA)).removedAt).toBeInstanceOf(Date);
    expect(await db.select().from(sessions).where(eq(sessions.userId, staff.id))).toHaveLength(0);
    const list = (await http().get('/api/staff').set(bearer(ownerA)).expect(200)).body;
    expect(list.map((m: { id: string }) => m.id)).not.toContain(staff.id);
    // Removing twice is "not found", not a second removal.
    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(404);
  });

  it('a correct 2FA code does not get a removed member back in', async () => {
    const email = `rm-2fa-${suffix}@test.uz`;
    const staff = await addStaff(ownerA, email, 'ACCOUNTANT');
    const s = (await login(email).expect(201)).body;
    const setup = (await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).expect(201)).body;
    await http().post('/api/auth/2fa/confirm').set(bearer(s.accessToken)).send({ code: await totp({ secret: setup.secret }) }).expect(201);
    // Password accepted, code pending - and removed in between.
    const pending = (await login(email).expect(201)).body;
    expect(pending.twoFactorRequired).toBe(true);

    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(200);

    await http().post('/api/auth/2fa/verify-login').send({ pendingToken: pending.pendingToken, code: await totp({ secret: setup.secret }) }).expect(401);
    // A fresh password + code attempt ends the same way.
    const again = (await login(email).expect(201)).body;
    expect(again.accessToken).toBeUndefined();
    await http().post('/api/auth/2fa/verify-login').send({ pendingToken: again.pendingToken, code: await totp({ secret: setup.secret }) }).expect(401);
    await expectLockedOut(s, email, tenantA);
  });

  it('an account with no membership row at all is not treated as a legacy account', async () => {
    // What older removals left behind: the row deleted outright.
    const email = `rm-gone-${suffix}@test.uz`;
    const staff = await addStaff(ownerA, email, 'ADMIN');
    const s = (await login(email).expect(201)).body;
    const handoff = (await http().post('/api/auth/handoff').set(bearer(s.accessToken)).expect(201)).body.code as string;
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, staff.id));
    expect((await db.select().from(users).where(eq(users.id, staff.id)))[0]).toMatchObject({ tenantId: tenantA, role: 'ADMIN' });

    await expectLockedOut(s, email, tenantA, handoff);
    expect((await login(email)).status).toBe(401);
  });

  it('removal from one center leaves the other center working', async () => {
    const email = `rm-two-${suffix}@test.uz`;
    const staff = await addStaff(ownerA, email, 'ACCOUNTANT');
    await addStaff(ownerB, email, 'TEACHER'); // the same person, added by the second center
    expect(await db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, staff.id))).toHaveLength(2);

    const first = (await login(email).expect(201)).body;
    expect(first.requiresWorkspaceSelection).toBe(true);
    const inA = (await http().post('/api/auth/select-workspace').set(bearer(first.accessToken)).send({ tenantId: tenantA, refreshToken: first.refreshToken }).expect(201)).body;
    const other = (await login(email).expect(201)).body;
    const inB = (await http().post('/api/auth/select-workspace').set(bearer(other.accessToken)).send({ tenantId: tenantB, refreshToken: other.refreshToken }).expect(201)).body;
    expect(inB.user.role).toBe('TEACHER');

    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(200);

    const again = await expectLockedOut(inA, email, tenantA);
    // Center B: the tokens held, refresh, /me and a new login all still work.
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ requiresWorkspaceSelection: false, tenant: { id: tenantB }, user: { role: 'TEACHER' } });
    await http().get('/api/groups').set(bearer(inB.accessToken)).expect(200);
    expect((await http().get('/api/auth/me').set(bearer(inB.accessToken)).expect(200)).body).toMatchObject({ tenant: { id: tenantB }, user: { role: 'TEACHER' } });
    const refreshed = (await http().post('/api/auth/refresh').send({ refreshToken: inB.refreshToken }).expect(201)).body;
    expect((await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(200)).body.tenant.id).toBe(tenantB);
    const ws = (await http().get('/api/auth/workspaces').set(bearer(refreshed.accessToken)).expect(200)).body;
    expect(ws.map((w: { tenantId: string }) => w.tenantId)).toEqual([tenantB]);
    expect(await membership(staff.id, tenantB)).toMatchObject({ status: 'ACTIVE', removedAt: null });
  });

  it('a suspended member stays out; adding or inviting them again is the way back', async () => {
    const email = `rm-back-${suffix}@test.uz`;
    const staff = await addStaff(ownerA, email, 'MANAGER');
    const s = (await login(email).expect(201)).body;

    await db.update(organizationMemberships).set({ status: 'SUSPENDED' }).where(eq(organizationMemberships.userId, staff.id));
    await expectLockedOut(s, email, tenantA);
    await db.update(organizationMemberships).set({ status: 'ACTIVE' }).where(eq(organizationMemberships.userId, staff.id));

    // Removed, then added again by the owner with another role.
    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(200);
    expect((await login(email)).status).toBe(401);
    const readded = await addStaff(ownerA, email, 'RECEPTIONIST');
    expect(readded.id).toBe(staff.id);
    expect(await membership(staff.id, tenantA)).toMatchObject({ status: 'ACTIVE', role: 'RECEPTIONIST', removedAt: null, removedByUserId: null });
    const back = (await login(email).expect(201)).body;
    expect(back).toMatchObject({ tenant: { id: tenantA }, user: { role: 'RECEPTIONIST' } });
    await http().get('/api/groups').set(bearer(back.accessToken)).expect(200);
    // The tokens from before the removal stay dead: that session was ended.
    await http().post('/api/auth/refresh').send({ refreshToken: s.refreshToken }).expect(401);

    // Removed again, then invited: accepting the invitation restores access.
    await http().delete(`/api/staff/${staff.id}`).set(bearer(ownerA)).expect(200);
    await http().get('/api/groups').set(bearer(back.accessToken)).expect(401);
    const inv = (await http().post('/api/invitations').set(bearer(ownerA)).send({ email, role: 'TEACHER' }).expect(201)).body;
    expect((await login(email)).status).toBe(401); // an unanswered invitation opens nothing
    await http().post(`/api/invitations/${inv.token}/accept`).send({ password }).expect(201);
    const invited = (await login(email).expect(201)).body;
    expect(invited).toMatchObject({ tenant: { id: tenantA }, user: { role: 'TEACHER' } });
    expect(await membership(staff.id, tenantA)).toMatchObject({ status: 'ACTIVE', role: 'TEACHER', removedAt: null });
  });

  it('a center created by the platform admin gives its admin a real membership', async () => {
    const saEmail = `rm-sa-${suffix}@test.uz`;
    const sa = (await http().post('/api/auth/register')
      .send({ centerName: `Rm SA ${suffix}`, subdomain: `rm-sa-${suffix}`, email: saEmail, password, fullName: 'Platform Admin' }).expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, sa.user.id));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, sa.user.id));
    const saToken = (await login(saEmail).expect(201)).body.accessToken as string;

    const adminEmail = `rm-made-${suffix}@test.uz`;
    const made = (await http().post('/api/tenants').set(bearer(saToken))
      .send({ name: `Rm Made ${suffix}`, subdomain: `rm-made-${suffix}`, adminEmail, adminPassword: password, adminFullName: 'Made Admin' }).expect(201)).body;
    expect(await membership(made.admin.id, made.tenant.id)).toMatchObject({ role: 'ADMIN', status: 'ACTIVE' });
    const admin = (await login(adminEmail).expect(201)).body;
    expect(admin).toMatchObject({ tenant: { id: made.tenant.id }, user: { role: 'ADMIN' } });
    await http().get('/api/groups').set(bearer(admin.accessToken)).expect(200);
    // The platform admin itself still works without a membership.
    await http().get('/api/tenants/overview').set(bearer(saToken)).expect(200);
  });
});
