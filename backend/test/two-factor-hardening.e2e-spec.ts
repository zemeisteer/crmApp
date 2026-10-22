import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import { generate as totp, generateSecret } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, users } from '../src/db/schema.js';

// Two-step sign-in that cannot be taken over by someone holding a session:
// replacing a factor needs the password and the current factor (or a
// recovery code); a new key is only pending until it is confirmed, expires,
// and is used once; the platform pages need a session that itself passed
// 2FA - an account flag is not enough - and refresh, workspace switching
// and handoff carry that, and nothing more.
describe('Two-factor hardening (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PASSWORD = 'password123';
  const before = process.env.SUPERADMIN_2FA;

  // A center owner (two workspaces later) and a platform admin.
  let ownerEmail: string;
  let saEmail: string, saId: string;

  const login = async (email: string) => (await http().post('/api/auth/login').send({ email, password: PASSWORD }).expect(201)).body;
  const loginWith2fa = async (email: string, code: string) => {
    const pending = await login(email);
    expect(pending.twoFactorRequired).toBe(true);
    return http().post('/api/auth/2fa/verify-login').send({ pendingToken: pending.pendingToken, code });
  };
  const enable = async (token: string) => {
    const setup = (await http().post('/api/auth/2fa/setup').set(bearer(token)).send({}).expect(201)).body;
    const done = (await http().post('/api/auth/2fa/confirm').set(bearer(token)).send({ code: await totp({ secret: setup.secret }) }).expect(201)).body;
    return { secret: setup.secret as string, recoveryCodes: done.recoveryCodes as string[] };
  };

  beforeAll(async () => {
    process.env.SUPERADMIN_2FA = 'on';
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    ownerEmail = `tf-owner-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `TF ${suffix}`, subdomain: `tf-${suffix}`, email: ownerEmail, password: PASSWORD, fullName: 'TF Owner' }).expect(201);
    saEmail = `tf-sa-${suffix}@test.uz`;
    const sa = (await http().post('/api/auth/register').send({ centerName: `TF root ${suffix}`, subdomain: `tf-root-${suffix}`, email: saEmail, password: PASSWORD, fullName: 'TF Platform' }).expect(201)).body;
    saId = sa.user.id;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, saId));
    await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, saId));
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (before === undefined) delete process.env.SUPERADMIN_2FA;
    else process.env.SUPERADMIN_2FA = before;
  });

  it('with 2FA on, a session alone cannot replace the key; the old authenticator keeps working', async () => {
    const s = await login(ownerEmail);
    const { secret } = await enable(s.accessToken);
    // A stolen session tries to put its own key in place.
    const r = await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).send({});
    expect([400, 403]).toContain(r.status);
    expect(r.body.secret).toBeUndefined();
    const [row] = await db.select({ secret: users.twoFactorSecret }).from(users).where(eq(users.email, ownerEmail));
    expect(row.secret).toBe(secret);
    // Wrong password or wrong code: refused too.
    await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).send({ password: 'nope-nope', code: await totp({ secret }) }).expect(403);
    await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).send({ password: PASSWORD, code: '000000' }).expect(403);
    (await loginWith2fa(ownerEmail, await totp({ secret }))).status === 201 || expect.fail('the old authenticator stopped working');
  });

  it('a replacement key is pending until confirmed: it signs in to nothing, the old one still does', async () => {
    const [{ secret: oldSecret }] = await db.select({ secret: users.twoFactorSecret }).from(users).where(eq(users.email, ownerEmail));
    const s = (await loginWith2fa(ownerEmail, await totp({ secret: oldSecret! })).then((r) => r.body));
    const pending = (await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).send({ password: PASSWORD, code: await totp({ secret: oldSecret! }) }).expect(201)).body;
    expect(pending.secret).not.toBe(oldSecret);
    // Not confirmed: the new key opens nothing, the old one still does.
    await loginWith2fa(ownerEmail, await totp({ secret: pending.secret })).then((r) => expect(r.status).toBe(401));
    await loginWith2fa(ownerEmail, await totp({ secret: oldSecret! })).then((r) => expect(r.status).toBe(201));

    // Confirmed: now the new one, and every other session of the account ends.
    const other = (await loginWith2fa(ownerEmail, await totp({ secret: oldSecret! }))).body;
    await http().post('/api/auth/2fa/confirm').set(bearer(s.accessToken)).send({ code: await totp({ secret: pending.secret }) }).expect(201);
    await http().get('/api/auth/me').set(bearer(other.accessToken)).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
    await http().get('/api/auth/me').set(bearer(s.accessToken)).expect(200);
    await loginWith2fa(ownerEmail, await totp({ secret: pending.secret })).then((r) => expect(r.status).toBe(201));
    // Used once: the same confirmation again finds nothing pending.
    await http().post('/api/auth/2fa/confirm').set(bearer(s.accessToken)).send({ code: await totp({ secret: pending.secret }) }).expect(400);
  });

  it('a pending key that expired, or a setup started and left, leaves the authenticator as it was', async () => {
    const [{ secret }] = await db.select({ secret: users.twoFactorSecret }).from(users).where(eq(users.email, ownerEmail));
    const s = (await loginWith2fa(ownerEmail, await totp({ secret: secret! }))).body;
    const pending = (await http().post('/api/auth/2fa/setup').set(bearer(s.accessToken)).send({ password: PASSWORD, code: await totp({ secret: secret! }) }).expect(201)).body;
    await db.update(users).set({ twoFactorPendingExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.email, ownerEmail));
    await http().post('/api/auth/2fa/confirm').set(bearer(s.accessToken)).send({ code: await totp({ secret: pending.secret }) }).expect(400);
    const [after] = await db.select({ secret: users.twoFactorSecret, enabled: users.twoFactorEnabled }).from(users).where(eq(users.email, ownerEmail));
    expect(after).toEqual({ secret, enabled: true });
    await loginWith2fa(ownerEmail, await totp({ secret: secret! })).then((r) => expect(r.status).toBe(201));
  });

  it('recovery codes: shown once at confirmation, each signs in once, and they let the owner replace a lost key', async () => {
    const email = `tf-rec-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `TF rec ${suffix}`, subdomain: `tf-rec-${suffix}`, email, password: PASSWORD, fullName: 'TF Rec' }).expect(201);
    const s = await login(email);
    const { recoveryCodes } = await enable(s.accessToken);
    expect(recoveryCodes).toHaveLength(10);
    const [row] = await db.select().from(users).where(eq(users.email, email));
    // Kept hashed only.
    expect(JSON.stringify(row)).not.toContain(recoveryCodes[0]);

    const r1 = await loginWith2fa(email, recoveryCodes[0]);
    expect(r1.status).toBe(201);
    await loginWith2fa(email, recoveryCodes[0]).then((r) => expect(r.status).toBe(401));

    // The phone is lost: password + a recovery code put a new key in place.
    const pending = (await http().post('/api/auth/2fa/setup').set(bearer(r1.body.accessToken)).send({ password: PASSWORD, code: recoveryCodes[1] }).expect(201)).body;
    const confirmed = (await http().post('/api/auth/2fa/confirm').set(bearer(r1.body.accessToken)).send({ code: await totp({ secret: pending.secret }) }).expect(201)).body;
    // New codes replace the old ones.
    expect(confirmed.recoveryCodes).toHaveLength(10);
    await loginWith2fa(email, recoveryCodes[2]).then((r) => expect(r.status).toBe(401));
  });

  it("a code from the step before still signs in (it was typed as the step turned); older ones and future ones do not", async () => {
    const email = `tf-step-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `TF step ${suffix}`, subdomain: `tf-step-${suffix}`, email, password: PASSWORD, fullName: 'TF Step' }).expect(201);
    const { secret } = await enable((await login(email)).accessToken);
    const at = (secondsAgo: number) => totp({ secret, epoch: Math.floor(Date.now() / 1000) - secondsAgo });
    expect((await loginWith2fa(email, await at(30))).status).toBe(201);
    expect((await loginWith2fa(email, await at(90))).status).toBe(401);
    expect((await loginWith2fa(email, await at(-60))).status).toBe(401);
  });

  it('turning 2FA off needs the password and the factor, and ends the other sessions', async () => {
    const email = `tf-off-${suffix}@test.uz`;
    await http().post('/api/auth/register').send({ centerName: `TF off ${suffix}`, subdomain: `tf-off-${suffix}`, email, password: PASSWORD, fullName: 'TF Off' }).expect(201);
    const s = await login(email);
    const { secret } = await enable(s.accessToken);
    const other = (await loginWith2fa(email, await totp({ secret }))).body;
    await http().post('/api/auth/2fa/disable').set(bearer(s.accessToken)).send({ code: await totp({ secret }) }).expect(403);
    await http().post('/api/auth/2fa/disable').set(bearer(s.accessToken)).send({ password: PASSWORD, code: await totp({ secret }) }).expect(201);
    await http().get('/api/auth/me').set(bearer(other.accessToken)).expect(401);
    await http().get('/api/auth/me').set(bearer(s.accessToken)).expect(200);
  });

  describe('the platform pages need a session that passed 2FA', () => {
    let secret: string;
    // A session from before 2FA was on (kept from the first test).
    let unverifiedToken: string;

    it('the account flag alone is not enough: a session from before 2FA was on is refused', async () => {
      const old = await login(saEmail);
      expect((await http().get('/api/platform/dashboard').set(bearer(old.accessToken)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');
      // 2FA turned on for the account behind this session's back.
      secret = generateSecret();
      await db.update(users).set({ twoFactorSecret: secret, twoFactorEnabled: true }).where(eq(users.id, saId));
      expect((await http().get('/api/platform/dashboard').set(bearer(old.accessToken)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');
      // Refreshing keeps the session's own state: still not verified.
      const refreshed = (await http().post('/api/auth/refresh').send({ refreshToken: old.refreshToken }).expect(201)).body;
      expect((await http().get('/api/platform/dashboard').set(bearer(refreshed.accessToken)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');
      unverifiedToken = refreshed.accessToken;
      const me = (await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(200)).body;
      expect(me.user).toMatchObject({ twoFactorEnabled: true, twoFactorRequired: true, sessionTwoFactor: false });
    });

    it('a sign-in through 2FA opens them, and keeps them over a refresh', async () => {
      const s = (await loginWith2fa(saEmail, await totp({ secret }))).body;
      await http().get('/api/platform/dashboard').set(bearer(s.accessToken)).expect(200);
      const refreshed = (await http().post('/api/auth/refresh').send({ refreshToken: s.refreshToken }).expect(201)).body;
      await http().get('/api/platform/dashboard').set(bearer(refreshed.accessToken)).expect(200);
      expect((await http().get('/api/auth/me').set(bearer(refreshed.accessToken)).expect(200)).body.user.sessionTwoFactor).toBe(true);
    });

    it('switching to a center or handing off carries the session\'s own state, never more', async () => {
      const email = `tf-ws-${suffix}@test.uz`;
      const a = (await http().post('/api/auth/register').send({ centerName: `TF ws ${suffix}`, subdomain: `tf-ws-${suffix}`, email, password: PASSWORD, fullName: 'TF Ws' }).expect(201)).body;
      const tenantId = a.tenant.id as string;
      // The platform admin may open a center; from an unverified session the
      // new session it gets is unverified too.
      const sw = (await http().post('/api/auth/select-workspace').set(bearer(unverifiedToken)).send({ tenantId }).expect(201)).body;
      expect((await http().get('/api/platform/dashboard').set(bearer(sw.accessToken)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');
      // Nor can it hand itself off to the center's address.
      expect((await http().post('/api/auth/handoff').set(bearer(sw.accessToken)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');

      const verified = (await loginWith2fa(saEmail, await totp({ secret }))).body;
      const sw2 = (await http().post('/api/auth/select-workspace').set(bearer(verified.accessToken)).send({ tenantId }).expect(201)).body;
      await http().get('/api/platform/dashboard').set(bearer(sw2.accessToken)).expect(200);
    });

    it('a handoff carries the 2FA state of the session that made it', async () => {
      // A center owner with 2FA: the handoff from a verified session is verified.
      const email = `tf-ho-${suffix}@test.uz`;
      await http().post('/api/auth/register').send({ centerName: `TF ho ${suffix}`, subdomain: `tf-ho-${suffix}`, email, password: PASSWORD, fullName: 'TF Ho' }).expect(201);
      const s = await login(email);
      const { secret: ownerSecret } = await enable(s.accessToken);
      const verified = (await loginWith2fa(email, await totp({ secret: ownerSecret }))).body;
      const { code } = (await http().post('/api/auth/handoff').set(bearer(verified.accessToken)).expect(201)).body;
      const there = (await http().post('/api/auth/handoff/exchange').send({ code }).expect(201)).body;
      expect((await http().get('/api/auth/me').set(bearer(there.accessToken)).expect(200)).body.user.sessionTwoFactor).toBe(true);
    });
  });
});
