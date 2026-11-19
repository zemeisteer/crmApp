import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { generate as totp } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, users } from '../src/db/schema.js';

// One's own account: the name can be changed (the e-mail and phone, which
// identify a person elsewhere, cannot); the password only with the current
// one, and with 2FA on one answer for any wrong part; the other devices are
// signed out, this one stays. The platform admin never works inside a center
// it is not an ACTIVE member of, checked on every request.
describe('Own account (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const PASSWORD = 'password123';
  const login = (email: string, password = PASSWORD) =>
    http().post('/api/auth/login').send({ email, password });
  const register = (tag: string, fullName = 'Test Owner') =>
    http()
      .post('/api/auth/register')
      .send({
        centerName: `OA ${tag} ${suffix}`,
        subdomain: `oa-${tag}-${suffix}`,
        email: `oa-${tag}-${suffix}@test.uz`,
        password: PASSWORD,
        fullName,
      })
      .expect(201);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerStorage)
      .useValue({
        increment: async () => ({
          totalHits: 1,
          timeToExpire: 0,
          isBlocked: false,
          timeToBlockExpire: 0,
        }),
      })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it("the name is the account's own to change; the e-mail and phone are not", async () => {
    const email = `oa-p-${suffix}@test.uz`;
    await register('p', 'Old Name');
    await db
      .update(users)
      .set({ phone: '+998901112233' })
      .where(eq(users.email, email));
    const s = (await login(email).expect(201)).body;
    const saved = (
      await http()
        .patch('/api/auth/me')
        .set(bearer(s.accessToken))
        .send({
          fullName: '  New   Name ',
          phone: '+998909999999',
          email: 'other@test.uz',
        })
        .expect(200)
    ).body;
    expect(saved).toMatchObject({ fullName: 'New Name', email });
    expect(
      (await http().get('/api/auth/me').set(bearer(s.accessToken)).expect(200))
        .body.user,
    ).toMatchObject({ fullName: 'New Name', phone: '+998901112233', email });
    // Nothing to change, or a name too short: refused.
    await http()
      .patch('/api/auth/me')
      .set(bearer(s.accessToken))
      .send({ phone: '+998909999999' })
      .expect(400);
    await http()
      .patch('/api/auth/me')
      .set(bearer(s.accessToken))
      .send({ fullName: 'x' })
      .expect(400);
    const row = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    expect(row).toMatchObject({
      email,
      phone: '+998901112233',
      fullName: 'New Name',
    });
    await http().patch('/api/auth/me').send({ fullName: 'Nobody' }).expect(401);
  });

  it('a new password needs the current one, and signs out the other devices only', async () => {
    const email = `oa-pw-${suffix}@test.uz`;
    await register('pw');
    const here = (await login(email).expect(201)).body;
    const other = (await login(email).expect(201)).body;
    const change = (body: object) =>
      http()
        .post('/api/auth/change-password')
        .set(bearer(here.accessToken))
        .send(body);

    expect(
      (
        await change({
          currentPassword: 'wrong-one',
          newPassword: 'NewPass456',
        }).expect(403)
      ).body.code,
    ).toBe('WRONG_PASSWORD');
    await change({ currentPassword: PASSWORD, newPassword: PASSWORD }).expect(
      400,
    );
    await change({ currentPassword: PASSWORD, newPassword: '123' }).expect(400);
    await change({
      currentPassword: PASSWORD,
      newPassword: 'NewPass456',
    }).expect(201);

    await login(email).expect(401);
    await login(email, 'NewPass456').expect(201);
    // The other device's session is gone; this one still refreshes.
    await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: other.refreshToken })
      .expect(401);
    await http()
      .post('/api/auth/refresh')
      .send({ refreshToken: here.refreshToken })
      .expect(201);
  });

  it('with 2FA on, a held session cannot tell a right password from a wrong one', async () => {
    const email = `oa-tf-${suffix}@test.uz`;
    await register('tf');
    const s = (await login(email).expect(201)).body;
    const setup = (
      await http()
        .post('/api/auth/2fa/setup')
        .set(bearer(s.accessToken))
        .send({})
        .expect(201)
    ).body;
    await http()
      .post('/api/auth/2fa/confirm')
      .set(bearer(s.accessToken))
      .send({ code: await totp({ secret: setup.secret }) })
      .expect(201);
    const change = (body: object) =>
      http()
        .post('/api/auth/change-password')
        .set(bearer(s.accessToken))
        .send(body);

    const wrong = (
      await change({
        currentPassword: 'wrong-one',
        newPassword: 'NewPass456',
      }).expect(403)
    ).body;
    const right = (
      await change({
        currentPassword: PASSWORD,
        newPassword: 'NewPass456',
      }).expect(403)
    ).body;
    expect(wrong).toEqual(right);
    await change({
      currentPassword: PASSWORD,
      newPassword: 'NewPass456',
      code: await totp({ secret: setup.secret }),
    }).expect(201);
    await login(email, 'NewPass456').expect(201);
  });

  it('the platform admin works inside a center only while an ACTIVE member of it', async () => {
    const center = (await register('c')).body;
    const sa = (await register('sa', 'Platform')).body;
    await db
      .update(users)
      .set({ role: 'SUPERADMIN' })
      .where(eq(users.id, sa.user.id));
    await db
      .delete(organizationMemberships)
      .where(eq(organizationMemberships.userId, sa.user.id));
    const saToken = (await login(`oa-sa-${suffix}@test.uz`).expect(201)).body
      .accessToken as string;

    // Not a member: no way in, and no such center in its workspace list.
    await http()
      .post('/api/auth/select-workspace')
      .set(bearer(saToken))
      .send({ tenantId: center.tenant.id })
      .expect(401);
    const list = (
      await http().get('/api/auth/workspaces').set(bearer(saToken)).expect(200)
    ).body as Array<{ tenantId: string }>;
    expect(list.some((w) => w.tenantId === center.tenant.id)).toBe(false);
    // The panel itself still works.
    await http().get('/api/tenants/overview').set(bearer(saToken)).expect(200);

    // A member: in. Membership suspended: the same token stops at once.
    await db
      .insert(organizationMemberships)
      .values({
        userId: sa.user.id,
        tenantId: center.tenant.id,
        role: 'ADMIN',
        status: 'ACTIVE',
      });
    const inside = (
      await http()
        .post('/api/auth/select-workspace')
        .set(bearer(saToken))
        .send({ tenantId: center.tenant.id })
        .expect(201)
    ).body.accessToken as string;
    await http().get('/api/students').set(bearer(inside)).expect(200);
    await db
      .update(organizationMemberships)
      .set({ status: 'SUSPENDED' })
      .where(
        and(
          eq(organizationMemberships.userId, sa.user.id),
          eq(organizationMemberships.tenantId, center.tenant.id),
        ),
      );
    await http().get('/api/students').set(bearer(inside)).expect(401);
  });
});
