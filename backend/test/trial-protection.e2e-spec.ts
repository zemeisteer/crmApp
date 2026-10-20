import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { generate as totp } from 'otplib';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { auditLogs, leads, organizationMemberships, platformSubscriptions, students, tenants, users } from '../src/db/schema.js';
import { TrialLifecycleService } from '../src/trial/trial-lifecycle.service.js';

// The free trial's guards (src/trial/trial-rules.ts), each switched on here
// (the other suites run with them off): a phone confirmed with a code at
// sign-up and one trial per number; limits during the trial; read-only and
// then locked after it; the deletion of unpaid trials that ended long ago;
// and two-step sign-in for the platform admin.
describe('Free trial protection (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let lifecycle: TrialLifecycleService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-6);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const DAY = 86_400_000;
  const FLAGS = ['SIGNUP_PHONE_CHECK', 'TRIAL_LIMITS', 'TRIAL_MAX_STUDENTS', 'TRIAL_MAX_STAFF', 'TRIAL_AI_PER_DAY', 'TRIAL_READONLY_DAYS', 'TRIAL_PURGE', 'TRIAL_PURGE_DAYS', 'SUPERADMIN_2FA'];
  const before = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
  let seq = 0;

  const signUp = (key: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/auth/register').send({ centerName: `TP ${key} ${suffix}`, subdomain: `tp-${key}-${suffix}`, email: `tp-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}`, ...extra });
  const center = async (key: string) => {
    process.env.SIGNUP_PHONE_CHECK = 'off';
    const body = (await signUp(key).expect(201)).body;
    process.env.SIGNUP_PHONE_CHECK = 'on';
    return { token: body.accessToken as string, tenantId: body.tenant.id as string };
  };
  const student = (token: string) =>
    http().post('/api/students').set(bearer(token)).send({ fullName: `TP Student ${++seq}`, phone: `+9989${tail}${String(seq).padStart(3, '0')}` });

  beforeAll(async () => {
    Object.assign(process.env, { SIGNUP_PHONE_CHECK: 'on', TRIAL_LIMITS: 'on', SUPERADMIN_2FA: 'off', TRIAL_PURGE: 'off' });
    // Many sign-ups from one address: the per-address throttle has its own suites.
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    lifecycle = app.get(TrialLifecycleService);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('sign-up with a confirmed phone', () => {
    const phone = `+99890${tail}1`;

    it('a sign-up without a confirmed phone is refused', async () => {
      const res = await signUp('nophone').expect(400);
      expect(res.body.code).toBe('PHONE_REQUIRED');
    });

    it('the code is sent once a minute; a wrong code is refused; the right one signs up', async () => {
      const sent = (await http().post('/api/auth/register/phone').send({ phone }).expect(201)).body;
      // No SMS provider and no e-mail here, and not production: the code comes back.
      expect(sent).toEqual({ channel: 'DEV', devCode: expect.stringMatching(/^\d{6}$/) });
      expect((await http().post('/api/auth/register/phone').send({ phone }).expect(429)).body.code).toBe('CODE_TOO_SOON');

      const wrong = sent.devCode === '123456' ? '654321' : '123456';
      expect((await signUp('phone', { phone, phoneCode: wrong }).expect(400)).body.code).toBe('CODE_WRONG');
      const ok = (await signUp('phone', { phone, phoneCode: sent.devCode }).expect(201)).body;
      const [row] = await db.select({ signupPhone: tenants.signupPhone }).from(tenants).where(eq(tenants.id, ok.tenant.id));
      expect(row.signupPhone).toBe(phone);
      // The phone stays on the server: /auth/me does not show it.
      const me = (await http().get('/api/auth/me').set(bearer(ok.accessToken)).expect(200)).body;
      expect(me.tenant.signupPhone).toBeUndefined();
      expect(me.tenant.trial.stage).toBe('TRIAL');
    });

    it('one free trial per number, however the number is written', async () => {
      const again = await http().post('/api/auth/register/phone').send({ phone: `998 90 ${tail} 1` }).expect(409);
      expect(again.body.code).toBe('PHONE_USED');
      expect((await signUp('again', { phone: `+998 90 ${tail}1`, phoneCode: '000000' }).expect(409)).body.code).toBe('PHONE_USED');
    });

    it('five wrong codes use the code up', async () => {
      const p = `+99891${tail}2`;
      const sent = (await http().post('/api/auth/register/phone').send({ phone: p }).expect(201)).body;
      const wrong = sent.devCode === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i++) await signUp('attempts', { phone: p, phoneCode: wrong }).expect(400);
      expect((await signUp('attempts', { phone: p, phoneCode: sent.devCode }).expect(400)).body.code).toBe('CODE_ATTEMPTS');
    });

    it('two sign-ups at once with the same number: one trial', async () => {
      process.env.SIGNUP_PHONE_CHECK = 'off';
      const p = `+99893${tail}3`;
      const results = await Promise.all(['race1', 'race2', 'race3'].map((k) => signUp(k, { phone: p })));
      process.env.SIGNUP_PHONE_CHECK = 'on';
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    });
  });

  describe('limits during the trial', () => {
    let owner: string, tenantId: string;

    beforeAll(async () => {
      ({ token: owner, tenantId } = await center('limits'));
      Object.assign(process.env, { TRIAL_MAX_STUDENTS: '3', TRIAL_MAX_STAFF: '1' });
    });
    afterAll(() => {
      delete process.env.TRIAL_MAX_STUDENTS;
      delete process.env.TRIAL_MAX_STAFF;
    });

    it('students up to the limit, even when added all at once; the trash counts when restored', async () => {
      const results = await Promise.all([1, 2, 3, 4, 5].map(() => student(owner)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      const refused = results.filter((r) => r.status !== 201);
      expect(refused.every((r) => r.status === 403 && r.body.code === 'TRIAL_LIMIT')).toBe(true);

      const first = results.find((r) => r.status === 201)!.body.id;
      await http().delete(`/api/students/${first}`).set(bearer(owner)).expect(200);
      await student(owner).expect(201); // room again
      expect((await http().post(`/api/students/${first}/restore`).set(bearer(owner)).expect(403)).body.code).toBe('TRIAL_LIMIT');
    });

    it('a lead becomes a student only while there is room', async () => {
      const lead = (await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'TP Lead', phone: `+99894${tail}4` }).expect(201)).body;
      await db.update(leads).set({ status: 'QUALIFIED' }).where(eq(leads.id, lead.id));
      expect((await http().post(`/api/leads/${lead.id}/convert`).set(bearer(owner)).send({ gender: 'FEMALE' }).expect(403)).body.code).toBe('TRIAL_LIMIT');
    });

    it('staff up to the limit (pending invitations count); no bulk import', async () => {
      await http().post('/api/invitations').set(bearer(owner)).send({ email: `tp-inv1-${suffix}@test.uz`, role: 'MANAGER' }).expect(201);
      expect((await http().post('/api/invitations').set(bearer(owner)).send({ email: `tp-inv2-${suffix}@test.uz`, role: 'MANAGER' }).expect(403)).body.code).toBe('TRIAL_LIMIT');
      expect((await http().post('/api/staff').set(bearer(owner)).send({ email: `tp-st-${suffix}@test.uz`, fullName: 'TP Staff', role: 'MANAGER', password: 'password12345' }).expect(403)).body.code).toBe('TRIAL_LIMIT');
      const res = await http().post('/api/import/students').set(bearer(owner)).attach('file', Buffer.from('x'), 'students.xlsx').expect(403);
      expect(res.body.code).toBe('TRIAL_LIMIT');
    });

    it('a paying center has no trial limits', async () => {
      await db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, tenantId));
      await student(owner).expect(201);
      await http().post('/api/invitations').set(bearer(owner)).send({ email: `tp-inv3-${suffix}@test.uz`, role: 'MANAGER' }).expect(201);
      await db.update(tenants).set({ status: 'TRIAL' }).where(eq(tenants.id, tenantId));
    });

    it('the AI: a daily allowance on the trial, none for a paying center', async () => {
      process.env.TRIAL_AI_PER_DAY = '2';
      const ask = () => http().post('/api/ai/suggest-homework').set(bearer(owner)).send({ subject: 'Ingliz tili', topic: 'Present Simple' });
      for (let i = 0; i < 2; i++) expect((await ask()).status).not.toBe(429);
      const third = await ask().expect(429);
      expect(third.body.code).toBe('TRIAL_AI_LIMIT');
      await db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, tenantId));
      expect((await ask()).status).not.toBe(429);
      await db.update(tenants).set({ status: 'TRIAL' }).where(eq(tenants.id, tenantId));
      delete process.env.TRIAL_AI_PER_DAY;
    });
  });

  describe('after the trial ends', () => {
    let owner: string, tenantId: string;

    beforeAll(async () => {
      ({ token: owner, tenantId } = await center('stages'));
      await student(owner).expect(201);
    });
    const endedDaysAgo = (days: number) => db.update(tenants).set({ trialEndsAt: new Date(Date.now() - days * DAY) }).where(eq(tenants.id, tenantId));

    it('read-only for two weeks: everything opens, nothing changes', async () => {
      await endedDaysAgo(1);
      expect((await http().get('/api/auth/me').set(bearer(owner)).expect(200)).body.tenant.trial.stage).toBe('READ_ONLY');
      await http().get('/api/students').set(bearer(owner)).expect(200);
      await http().get('/api/groups').set(bearer(owner)).expect(200);
      await student(owner).expect(403);
      // Also on routes the older write guard does not cover.
      const lead = await http().post('/api/leads').set(bearer(owner)).send({ fullName: 'TP Late Lead', phone: `+99895${tail}5` }).expect(403);
      expect(lead.body.code).toBe('TRIAL_READ_ONLY');
    });

    it('then locked: only signing in, its own data, and the plans and payment', async () => {
      await endedDaysAgo(15);
      const me = (await http().get('/api/auth/me').set(bearer(owner)).expect(200)).body;
      expect(me.tenant.trial.stage).toBe('LOCKED');
      for (const path of ['/api/students', '/api/groups', '/api/leads', '/api/payments']) {
        expect((await http().get(path).set(bearer(owner)).expect(403)).body.code).toBe('TRIAL_LOCKED');
      }
      await http().get('/api/plans/public').set(bearer(owner)).expect(200);
      await http().get('/api/tenants/me/export').set(bearer(owner)).expect(200);
      const pay = await http().post('/api/platform-billing/click/link').set(bearer(owner)).send({ plan: 'STANDARD' });
      expect(pay.body?.code).not.toBe('TRIAL_LOCKED');
    });

    it('paying opens everything again', async () => {
      await db.update(tenants).set({ status: 'ACTIVE' }).where(eq(tenants.id, tenantId));
      await http().get('/api/students').set(bearer(owner)).expect(200);
      await student(owner).expect(201);
    });
  });

  describe('unpaid trials that ended long ago', () => {
    it('two notices, then the center and everything in it is deleted; a center that paid is kept', async () => {
      Object.assign(process.env, { TRIAL_PURGE: 'on', TRIAL_PURGE_DAYS: '60' });
      const doomed = await center('purge');
      const paid = await center('paid');
      for (const c of [doomed, paid]) await student(c.token).expect(201);
      // The platform has recorded a payment from the second one.
      await db.insert(platformSubscriptions).values({ tenantId: paid.tenantId, plan: 'STANDARD', amount: 1, forMonth: '2026-01', status: 'PAID', paidAt: new Date() });
      // A payment link opened but never paid does not count.
      await db.insert(platformSubscriptions).values({ tenantId: doomed.tenantId, plan: 'STANDARD', amount: 1, forMonth: '2026-02', status: 'CREATED' });
      const now = Date.now();
      // Ended 47 days ago: the deletion date is 13 days ahead.
      for (const c of [doomed, paid]) await db.update(tenants).set({ trialEndsAt: new Date(now - 47 * DAY) }).where(eq(tenants.id, c.tenantId));
      const ids = [doomed.tenantId, paid.tenantId];

      let r = await lifecycle.run(new Date(now), ids);
      expect(r).toMatchObject({ warned: 1, deleted: 0 });
      expect((await lifecycle.run(new Date(now), ids)).warned).toBe(0); // told once
      // The pass did not run for two weeks (the deletion date has passed):
      // the last notice goes out first, and nothing is deleted with it ...
      r = await lifecycle.run(new Date(now + 14 * DAY), ids);
      expect(r).toMatchObject({ warned: 1, deleted: 0 });
      // ... nor while that notice is under 6 days old ...
      expect((await lifecycle.run(new Date(now + 19 * DAY), ids)).deleted).toBe(0);
      // ... then the center goes; the one that paid stays.
      r = await lifecycle.run(new Date(now + 20 * DAY), ids);
      expect(r.deletedIds).toEqual([doomed.tenantId]);

      expect(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, doomed.tenantId))).toEqual([]);
      expect(await db.select({ id: students.id }).from(students).where(eq(students.tenantId, doomed.tenantId))).toEqual([]);
      expect(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, paid.tenantId))).toHaveLength(1);
      const [log] = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'trial_purge'), eq(auditLogs.entityId, doomed.tenantId)));
      expect(log).toBeDefined();
    });

    it('nothing is deleted or announced while TRIAL_PURGE is off', async () => {
      process.env.TRIAL_PURGE = 'off';
      const c = await center('nopurge');
      await db.update(tenants).set({ trialEndsAt: new Date(Date.now() - 400 * DAY) }).where(eq(tenants.id, c.tenantId));
      expect(await lifecycle.run(new Date(), [c.tenantId])).toMatchObject({ warned: 0, deleted: 0 });
      expect(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, c.tenantId))).toHaveLength(1);
    });
  });

  describe('the platform admin', () => {
    it('the platform pages open only with two-step sign-in on; every sign-in is logged', async () => {
      process.env.SUPERADMIN_2FA = 'on';
      process.env.SIGNUP_PHONE_CHECK = 'off';
      const email = `tp-sa-${suffix}@test.uz`;
      const reg = (await http().post('/api/auth/register').send({ centerName: `TP root ${suffix}`, subdomain: `tp-root-${suffix}`, email, password: 'password123', fullName: 'Platform Admin' }).expect(201)).body;
      process.env.SIGNUP_PHONE_CHECK = 'on';
      await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, reg.user.id));
      await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, reg.user.id));
      const sa = (await http().post('/api/auth/login').send({ email, password: 'password123' }).expect(201)).body.accessToken;

      const logins = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'superadmin_login'), eq(auditLogs.userId, reg.user.id)));
      expect(logins.length).toBeGreaterThan(0);

      expect((await http().get('/api/auth/me').set(bearer(sa)).expect(200)).body.user.twoFactorRequired).toBe(true);
      expect((await http().get('/api/platform/dashboard').set(bearer(sa)).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');
      expect((await http().post('/api/plans').set(bearer(sa)).send({ key: `TP_${suffix}`, name: 'x', price: 1 }).expect(403)).body.code).toBe('TWO_FACTOR_REQUIRED');

      // Setting it up is open (it is under /auth).
      const setup = (await http().post('/api/auth/2fa/setup').set(bearer(sa)).expect(201)).body;
      await http().post('/api/auth/2fa/confirm').set(bearer(sa)).send({ code: await totp({ secret: setup.secret }) }).expect(201);
      await http().get('/api/platform/dashboard').set(bearer(sa)).expect(200);

      process.env.SUPERADMIN_2FA = 'off';
    });
  });
});
