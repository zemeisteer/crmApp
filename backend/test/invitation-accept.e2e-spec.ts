import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { createHash } from 'crypto';
import { vi } from 'vitest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { invitations, organizationMemberships, users } from '../src/db/schema.js';

// Accepting an invitation: one transaction adds the member and marks the
// invitation used, so requests at the same moment give clear answers.
describe('Invitation accept (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  let n = 0;

  const center = async () => {
    const key = `ia${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `IA ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    return { id: body.tenant.id as string, token: body.accessToken as string };
  };
  const invite = async (c: { token: string }, email: string) =>
    (await http().post('/api/invitations').set({ Authorization: `Bearer ${c.token}` }).send({ email, role: 'MANAGER' }).expect(201)).body.token as string;

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

  it('two centers invite the same new person and both accepts look the person up before either creates the account: a clear 409, never a server error', async () => {
    const email = `ia-new-${suffix}@test.uz`;
    const [a, b] = [await center(), await center()];
    const [ta, tb] = [await invite(a, email), await invite(b, email)];
    await http().post(`/api/invitations/${ta}/accept`).send({ fullName: 'IA New', password: 'password123' }).expect(201);
    // The second request looked the account up a moment before the first created it.
    const lookup = vi.spyOn(db.query.users, 'findFirst').mockResolvedValueOnce(undefined);
    const res = await http().post(`/api/invitations/${tb}/accept`).send({ fullName: 'IA New', password: 'password123' });
    lookup.mockRestore();
    expect([res.status, res.body.code]).toEqual([409, 'ACCOUNT_EXISTS']);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.email, email))).toHaveLength(1);
    // Nothing half done: the invitation is still open, and accepting it again (now as the existing account) works.
    const hash = createHash('sha256').update(tb).digest('hex');
    expect((await db.select({ status: invitations.status }).from(invitations).where(eq(invitations.tokenHash, hash)))[0].status).toBe('PENDING');
    await http().post(`/api/invitations/${tb}/accept`).send({ password: 'password123' }).expect(201);
  });

  it('the same invitation accepted twice at once: one member, the other told it was used', async () => {
    const c = await center();
    const t = await invite(c, `ia-twice-${suffix}@test.uz`);
    const answers = await Promise.all([1, 2].map(() => http().post(`/api/invitations/${t}/accept`).send({ fullName: 'IA Twice', password: 'password123' })));
    expect(answers.map((r) => r.status).sort()).toEqual([201, expect.any(Number)].sort());
    expect(answers.filter((r) => r.status === 201)).toHaveLength(1);
    expect(answers.every((r) => r.status < 500)).toBe(true);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, `ia-twice-${suffix}@test.uz`));
    expect(await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.userId, u.id), eq(organizationMemberships.tenantId, c.id)))).toHaveLength(1);
  });

  it('an existing account joins with its password; a wrong one is refused and leaves the invitation open', async () => {
    const [a, b] = [await center(), await center()];
    const email = `ia-old-${suffix}@test.uz`;
    await http().post(`/api/invitations/${await invite(a, email)}/accept`).send({ fullName: 'IA Old', password: 'password123' }).expect(201);
    const t = await invite(b, email);
    await http().post(`/api/invitations/${t}/accept`).send({ password: 'wrong-password' }).expect(401);
    await http().post(`/api/invitations/${t}/accept`).send({ password: 'password123' }).expect(201);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    expect(await db.select().from(organizationMemberships).where(eq(organizationMemberships.userId, u.id))).toHaveLength(2);
  });
});
