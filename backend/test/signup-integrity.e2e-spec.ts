import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, platformSubscriptions, signupPhoneCodes, tenants, users } from '../src/db/schema.js';
import { AuthService } from '../src/auth/auth.service.js';
import { EmailService } from '../src/email/email.service.js';
import { EskizProvider } from '../src/notifications/sms/eskiz.provider.js';

// Sign-up: the phone is really the person's (an SMS, never an e-mail in its
// place); a code belongs to one phone and one sign-up attempt, and the
// newest one alone counts; limits hold under requests at once; the writes
// are all or nothing, a retry makes no second center; and a phone's free
// trial stays used after its center is deleted.
describe('Sign-up integrity (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let auth: AuthService;
  let email: EmailService;
  let sms: EskizProvider;
  const suffix = Date.now();
  const tail = String(suffix).slice(-6);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const KEYS = ['SIGNUP_PHONE_CHECK', 'NODE_ENV', 'ESKIZ_API_TOKEN', 'PLAYMOBILE_API_TOKEN', 'TRIAL_PHONE_KEY', 'SIGNUP_CODES_PER_IP_HOUR'];
  const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  let n = 0;
  const phone = () => `+99890${tail.slice(-5)}${String(++n).padStart(2, '0')}`;
  const body = (key: string, extra: Record<string, unknown> = {}) => ({
    centerName: `SI ${key} ${suffix}`, subdomain: `si-${key}-${suffix}`, email: `si-${key}-${suffix}@test.uz`, password: 'password123', fullName: `Owner ${key}`, ...extra,
  });
  const start = (p: string, extra: Record<string, unknown> = {}) => http().post('/api/auth/register/phone').send({ phone: p, ...extra });
  const register = (key: string, extra: Record<string, unknown> = {}) => http().post('/api/auth/register').send(body(key, extra));
  /** A code by the development channel (no SMS provider here). */
  const devCode = async (p: string) => {
    const r = (await start(p).expect(201)).body;
    expect(r.channel).toBe('DEV');
    return { code: r.devCode as string, attempt: r.attemptId as string };
  };
  const backdate = (p: string) => db.update(signupPhoneCodes).set({ createdAt: new Date(Date.now() - 120_000) }).where(eq(signupPhoneCodes.phone, p));

  beforeAll(async () => {
    Object.assign(process.env, { SIGNUP_PHONE_CHECK: 'on', ESKIZ_API_TOKEN: '', PLAYMOBILE_API_TOKEN: '', TRIAL_PHONE_KEY: `si-key-${suffix}`, SIGNUP_CODES_PER_IP_HOUR: '1000' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    // One listening server: requests at once would otherwise each start
    // their own (supertest), which can reset connections on a busy runner.
    await app.listen(0);
    db = app.get<Database>(DB);
    auth = app.get(AuthService);
    email = app.get(EmailService);
    sms = app.get(EskizProvider, { strict: false });
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('the phone is really confirmed', () => {
    it('in production without an SMS provider: "unavailable", never an e-mail in its place', async () => {
      process.env.NODE_ENV = 'production';
      try {
        const r = await start(phone(), { email: `si-mail-${suffix}@test.uz` });
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SMS_UNAVAILABLE');
        expect(r.body.devCode).toBeUndefined();
      } finally {
        process.env.NODE_ENV = before.NODE_ENV ?? 'test';
      }
    });

    it('with an SMS provider the code goes by SMS (the adapter here), and is not in the answer', async () => {
      process.env.ESKIZ_API_TOKEN = 'adapter-token';
      const send = vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValue({ success: true, messageId: 'm-1' });
      try {
        const p = phone();
        const r = (await start(p).expect(201)).body;
        expect(r).toMatchObject({ channel: 'SMS' });
        expect(r.devCode).toBeUndefined();
        expect(send).toHaveBeenCalledTimes(1);
        const [to, text] = send.mock.calls[0];
        expect(to).toBe(p);
        const code = /(\d{6})/.exec(String(text))![1];
        const ok = await register('sms', { phone: p, phoneCode: code, signupAttemptId: r.attemptId });
        expect(ok.status).toBe(201);
      } finally {
        process.env.ESKIZ_API_TOKEN = '';
      }
    });

    it('an SMS that could not be sent is not "sent", and its code opens nothing', async () => {
      process.env.ESKIZ_API_TOKEN = 'adapter-token';
      let text = '';
      vi.spyOn(EskizProvider.prototype, 'sendSms').mockImplementation(async (_to, t) => {
        text = String(t);
        return { success: false, error: 'provider down' };
      });
      try {
        const p = phone();
        const r = await start(p);
        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SMS_FAILED');
        const code = /(\d{6})/.exec(text)![1];
        expect((await register('smsfail', { phone: p, phoneCode: code, signupAttemptId: 'x' })).status).toBe(400);
      } finally {
        process.env.ESKIZ_API_TOKEN = '';
      }
    });

    it('a code belongs to its phone and its sign-up attempt', async () => {
      const a = phone();
      const b = phone();
      const { code, attempt } = await devCode(a);
      // Another attempt id, or the code on another phone: refused.
      expect((await register('bind1', { phone: a, phoneCode: code, signupAttemptId: 'someone-else' })).status).toBe(400);
      await devCode(b);
      expect((await register('bind2', { phone: b, phoneCode: code, signupAttemptId: attempt })).status).toBe(400);
      expect((await register('bind3', { phone: a, phoneCode: code, signupAttemptId: attempt })).status).toBe(201);
    });

    it('a new code makes the earlier one invalid', async () => {
      const p = phone();
      const first = await devCode(p);
      await backdate(p);
      const second = await devCode(p);
      expect((await register('old', { phone: p, phoneCode: first.code, signupAttemptId: first.attempt })).status).toBe(400);
      expect((await register('new', { phone: p, phoneCode: second.code, signupAttemptId: second.attempt })).status).toBe(201);
    });

    it('one address cannot ask for codes for many phones', async () => {
      process.env.SIGNUP_CODES_PER_IP_HOUR = '3';
      try {
        // Earlier tests already asked from this address: the limit is reached.
        const r = await start(phone());
        expect(r.status).toBe(429);
        expect(r.body.code).toBe('CODE_IP_LIMIT');
      } finally {
        process.env.SIGNUP_CODES_PER_IP_HOUR = '1000';
      }
    });

    it('limits hold under requests at once: one code per minute, five wrong guesses in all', async () => {
      const p = phone();
      const starts = await Promise.all([1, 2, 3, 4, 5].map(() => start(p)));
      expect(starts.filter((r) => r.status === 201)).toHaveLength(1);
      expect(starts.filter((r) => r.status === 429)).toHaveLength(4);
      const { devCode: code, attemptId } = starts.find((r) => r.status === 201)!.body;
      const wrong = code === '111111' ? '222222' : '111111';
      await Promise.all(Array.from({ length: 10 }, (_, i) => register(`guess${i}`, { phone: p, phoneCode: wrong, signupAttemptId: attemptId })));
      const [row] = await db.select({ attempts: signupPhoneCodes.attempts }).from(signupPhoneCodes).where(eq(signupPhoneCodes.phone, p));
      expect(row.attempts).toBeLessThanOrEqual(5);
      const after = await register('guessok', { phone: p, phoneCode: code, signupAttemptId: attemptId });
      expect(after.status).toBe(400);
      expect(after.body.code).toBe('CODE_ATTEMPTS');
    });
  });

  describe('the sign-up is all or nothing', () => {
    for (const step of ['createTenant', 'createOwner', 'createMembership', 'claimTrial'] as const) {
      it(`a failure at ${step} leaves nothing behind, and the same code then works`, async () => {
        const p = phone();
        const { code, attempt } = await devCode(p);
        const real = (auth as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[step].bind(auth);
        (vi.spyOn(auth as never, step as never) as unknown as { mockImplementationOnce: (f: unknown) => void }).mockImplementationOnce((async (...args: unknown[]) => {
          await real(...args);
          throw new Error(`injected: ${step} failed`);
        }) as never);
        const failed = await register(`f${step.length}${step.slice(-4).toLowerCase()}`, { phone: p, phoneCode: code, signupAttemptId: attempt });
        expect(failed.status).toBe(500);
        expect(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.subdomain, `si-f${step.length}${step.slice(-4).toLowerCase()}-${suffix}`))).toEqual([]);
        expect(await db.select({ id: users.id }).from(users).where(eq(users.email, `si-f${step.length}${step.slice(-4).toLowerCase()}-${suffix}@test.uz`))).toEqual([]);
        // The code was not used up, and the phone is not taken.
        const ok = await register(`f${step.length}${step.slice(-4).toLowerCase()}`, { phone: p, phoneCode: code, signupAttemptId: attempt });
        expect(ok.status).toBe(201);
      });
    }

    it('the same e-mail, phone or address at once: one center, the others a clear conflict', async () => {
      process.env.SIGNUP_PHONE_CHECK = 'off';
      try {
        const same = await Promise.all(['r1', 'r2', 'r3'].map((k) => http().post('/api/auth/register').send({ ...body(k), email: `si-same-${suffix}@test.uz` })));
        expect(same.map((r) => r.status).sort()).toEqual([201, 409, 409]);
        const sub = await Promise.all(['s1', 's2'].map((k) => http().post('/api/auth/register').send({ ...body(k), subdomain: `si-samesub-${suffix}` })));
        expect(sub.map((r) => r.status).sort()).toEqual([201, 409]);
      } finally {
        process.env.SIGNUP_PHONE_CHECK = 'on';
      }
    });

    it('a retry of the same attempt (the answer was lost) makes no second center', async () => {
      const p = phone();
      const { code, attempt } = await devCode(p);
      const first = (await register('retry', { phone: p, phoneCode: code, signupAttemptId: attempt }).expect(201)).body;
      const again = await register('retry', { phone: p, phoneCode: code, signupAttemptId: attempt });
      expect(again.status).toBe(201);
      expect(again.body.tenant.id).toBe(first.tenant.id);
      expect(await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.subdomain, `si-retry-${suffix}`))).toHaveLength(1);
      // With another password it is not handed over.
      expect((await register('retry', { phone: p, phoneCode: code, signupAttemptId: attempt, password: 'not-the-same-1' })).status).toBe(409);
    });

    it('an e-mail that fails to go out does not fail the sign-up', async () => {
      vi.spyOn(email, 'send').mockRejectedValue(new Error('mail server down'));
      const p = phone();
      const { code, attempt } = await devCode(p);
      expect((await register('nomail', { phone: p, phoneCode: code, signupAttemptId: attempt })).status).toBe(201);
    });
  });

  describe('one phone, one free trial - also after the center is gone', () => {
    const signUpWith = async (key: string, p: string) => {
      const { code, attempt } = await devCode(p);
      return register(key, { phone: p, phoneCode: code, signupAttemptId: attempt });
    };

    it('deleted by its owner: the phone has still had its trial', async () => {
      const p = phone();
      const first = (await signUpWith('del1', p).then((r) => r.body));
      await http().delete('/api/tenants/me').set(bearer(first.accessToken)).send({ password: 'password123' }).expect(200);
      await backdate(p);
      const again = await start(p);
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('PHONE_USED');
    });

    it('a center that paid may sign up again after deletion, without a new free trial', async () => {
      const p = phone();
      const first = (await signUpWith('paid1', p)).body;
      await db.insert(platformSubscriptions).values({ tenantId: first.tenant.id, plan: 'STANDARD', amount: 1, forMonth: '2026-01', status: 'PAID', paidAt: new Date() });
      await http().delete('/api/tenants/me').set(bearer(first.accessToken)).send({ password: 'password123' }).expect(200);
      await backdate(p);
      const again = (await signUpWith('paid2', p).then((r) => { expect(r.status).toBe(201); return r.body; }));
      const me = (await http().get('/api/auth/me').set(bearer(again.accessToken)).expect(200)).body;
      expect(me.tenant.trial.stage).not.toBe('TRIAL');
    });

    it('the platform admin may release a phone (audited); then it gets a trial again', async () => {
      const p = phone();
      const first = (await signUpWith('rel1', p)).body;
      await http().delete('/api/tenants/me').set(bearer(first.accessToken)).send({ password: 'password123' }).expect(200);
      const saEmail = `si-sa-${suffix}@test.uz`;
      process.env.SIGNUP_PHONE_CHECK = 'off';
      const reg = (await http().post('/api/auth/register').send({ ...body('sa'), email: saEmail }).expect(201)).body;
      process.env.SIGNUP_PHONE_CHECK = 'on';
      await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, reg.user.id));
      await db.delete(organizationMemberships).where(eq(organizationMemberships.userId, reg.user.id));
      const sa = (await http().post('/api/auth/login').send({ email: saEmail, password: 'password123' }).expect(201)).body.accessToken;
      await http().post('/api/platform/trial-claims/release').set(bearer(sa)).send({ phone: p }).expect(400); // a reason is required
      await http().post('/api/platform/trial-claims/release').set(bearer(sa)).send({ phone: p, reason: 'Hujjat bilan tasdiqlangan qayta ochish' }).expect(201);
      await backdate(p);
      const again = (await signUpWith('rel2', p)).body;
      const me = (await http().get('/api/auth/me').set(bearer(again.accessToken)).expect(200)).body;
      expect(me.tenant.trial.stage).toBe('TRIAL');
      const logs = await db.execute(sql`select count(*)::int as n from audit_logs where action = 'trial_claim_released'`);
      expect(Number((logs as unknown as { rows: Array<{ n: number }> }).rows?.[0]?.n ?? (logs as unknown as Array<{ n: number }>)[0]?.n)).toBeGreaterThan(0);
    });

    it('phones of centers made before this change count as used too', async () => {
      const p = phone();
      process.env.SIGNUP_PHONE_CHECK = 'off';
      const legacy = (await http().post('/api/auth/register').send(body('legacy')).expect(201)).body;
      process.env.SIGNUP_PHONE_CHECK = 'on';
      await db.update(tenants).set({ signupPhone: p }).where(eq(tenants.id, legacy.tenant.id));
      await auth.backfillTrialClaims();
      await db.delete(tenants).where(and(eq(tenants.id, legacy.tenant.id)));
      const r = await start(p);
      expect(r.status).toBe(409);
    });
  });
});
