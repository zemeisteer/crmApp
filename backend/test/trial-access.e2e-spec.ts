import { Test, TestingModule } from '@nestjs/testing';
import { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, Database } from '../src/db/db.module.js';
import { organizationMemberships, tenants } from '../src/db/schema.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { EskizProvider } from '../src/notifications/sms/eskiz.provider.js';
import { RemindersService } from '../src/reminders/reminders.service.js';
import { StudentTutorService } from '../src/ai/student-tutor.service.js';
import { AiService } from '../src/ai/ai.service.js';
import { MockTestsService } from '../src/mock-tests/mock-tests.service.js';

// What a center may do in each state of its life (one table for the guard
// and the interceptor), the trial limits on the side doors (invitation
// accept, the students' AI tutor), and SMS on the platform's account: never
// for a center that is gone, on no plan, suspended or locked; within a
// monthly budget reserved atomically; one message per key, also after a
// provider timeout. No SMS leaves the machine: the provider is replaced.
describe('Trial states, side doors and the platform SMS budget (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let notifications: NotificationsService;
  const suffix = Date.now();
  const tail = String(suffix).slice(-5);
  const http = () => request(app.getHttpServer() as App);
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const DAY = 86_400_000;
  const FLAGS = ['TRIAL_LIMITS', 'TRIAL_MAX_STAFF', 'TRIAL_AI_PER_DAY', 'TRIAL_READONLY_DAYS', 'PLATFORM_SMS_PER_CENTER_MONTH', 'PLATFORM_SMS_PER_MONTH'];
  const before = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
  let n = 0;

  const center = async () => {
    const key = `ta${++n}${tail}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `TA ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    return { id: body.tenant.id as string, token: body.accessToken as string, key };
  };
  type State = 'ACTIVE' | 'TRIAL' | 'READ_ONLY' | 'LOCKED' | 'SUSPENDED';
  const put = (id: string, s: State) => {
    const now = Date.now();
    const set =
      s === 'ACTIVE' ? { status: 'ACTIVE' as const, trialEndsAt: new Date(now - 100 * DAY) }
      : s === 'SUSPENDED' ? { status: 'SUSPENDED' as const }
      : s === 'TRIAL' ? { status: 'TRIAL' as const, trialEndsAt: new Date(now + 5 * DAY) }
      : s === 'READ_ONLY' ? { status: 'TRIAL' as const, trialEndsAt: new Date(now - DAY) }
      : { status: 'TRIAL' as const, trialEndsAt: new Date(now - 30 * DAY) };
    return db.update(tenants).set(set).where(eq(tenants.id, id));
  };
  const code = (res: request.Response) => (res.status === 403 || res.status === 429 ? res.body.code ?? 'FORBIDDEN' : res.status);

  beforeAll(async () => {
    Object.assign(process.env, { TRIAL_LIMITS: 'on', TRIAL_READONLY_DAYS: '14' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    notifications = app.get(NotificationsService);
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe('the permission matrix', () => {
    // [route, expected per state: ACTIVE, TRIAL, READ_ONLY, LOCKED, SUSPENDED]
    // a number is the status, a string the refusal's code.
    type Row = [string, (c: { token: string; key: string }) => request.Test, [unknown, unknown, unknown, unknown, unknown]];
    const ok = 'OPEN';
    const rows: Row[] = [
      ['read students', (c) => http().get('/api/students').set(bearer(c.token)), [ok, ok, ok, 'TRIAL_LOCKED', ok]],
      ['add a student', (c) => http().post('/api/students').set(bearer(c.token)).send({ fullName: `TA S ${++n}`, phone: `+99893${tail}${String(n).padStart(2, '0')}` }), [ok, ok, 'TRIAL_READ_ONLY', 'TRIAL_LOCKED', 'CENTER_SUSPENDED']],
      // Not behind TrialGuard: only the interceptor stands here.
      ['rename the center', (c) => http().patch('/api/tenants/me').set(bearer(c.token)).send({ name: `TA renamed ${c.key}` }), [ok, ok, 'TRIAL_READ_ONLY', 'TRIAL_LOCKED', 'CENTER_SUSPENDED']],
      ['change notification settings', (c) => http().patch('/api/notifications/settings').set(bearer(c.token)).send({ notifyOnPayment: true }), [ok, ok, 'TRIAL_READ_ONLY', 'TRIAL_LOCKED', 'CENTER_SUSPENDED']],
      ['who am I', (c) => http().get('/api/auth/me').set(bearer(c.token)), [ok, ok, ok, ok, ok]],
      ['the plans', (c) => http().get('/api/plans/public').set(bearer(c.token)), [ok, ok, ok, ok, ok]],
      ['take the data away', (c) => http().get('/api/tenants/me/export').set(bearer(c.token)), [ok, ok, ok, ok, ok]],
      ['pay for a plan', (c) => http().post('/api/platform-billing/click/link').set(bearer(c.token)).send({ plan: 'STANDARD', forMonth: '2026-11' }), [ok, ok, ok, ok, ok]],
      ['the payment provider calls back', () => http().post('/api/platform-billing/payme/webhook').send({ method: 'CheckPerformTransaction', params: {}, id: 1 }), [ok, ok, ok, ok, ok]],
    ];
    const states: State[] = ['ACTIVE', 'TRIAL', 'READ_ONLY', 'LOCKED', 'SUSPENDED'];

    it('every state answers every route as the table says', async () => {
      const c = await center();
      const got: string[] = [];
      const want: string[] = [];
      for (const [i, s] of states.entries()) {
        await put(c.id, s);
        for (const [name, call, expected] of rows) {
          const res = await call(c);
          const blocked = res.status === 403 && typeof res.body.code === 'string' && /^(TRIAL_|CENTER_)/.test(res.body.code);
          got.push(`${s} ${name}: ${blocked ? res.body.code : ok}`);
          want.push(`${s} ${name}: ${expected[i]}`);
        }
      }
      expect(got).toEqual(want);
    });
  });

  describe('trial limits on the side doors', () => {
    it('accepting an invitation counts against the staff limit', async () => {
      process.env.TRIAL_MAX_STAFF = '2';
      const c = await center();
      const invite = async (who: string) => (await http().post('/api/invitations').set(bearer(c.token)).send({ email: `${c.key}-${who}@test.uz`, role: 'MANAGER' }).expect(201)).body.token as string;
      const [a, b] = [await invite('a'), await invite('b')];
      // The platform lowered the limit since (or the invitations predate it).
      process.env.TRIAL_MAX_STAFF = '1';
      await http().post(`/api/invitations/${a}/accept`).send({ fullName: 'TA A', password: 'password123' }).expect(201);
      const res = await http().post(`/api/invitations/${b}/accept`).send({ fullName: 'TA B', password: 'password123' });
      expect(code(res)).toBe('TRIAL_LIMIT');
      const members = await db.select().from(organizationMemberships).where(and(eq(organizationMemberships.tenantId, c.id), eq(organizationMemberships.status, 'ACTIVE')));
      expect(members).toHaveLength(2); // the owner and A
      process.env.TRIAL_MAX_STAFF = '3';
    });

    it('nobody joins a center whose trial is over, or one that is suspended', async () => {
      for (const s of ['LOCKED', 'READ_ONLY', 'SUSPENDED'] as const) {
        const c = await center();
        const token = (await http().post('/api/invitations').set(bearer(c.token)).send({ email: `${c.key}-late@test.uz`, role: 'MANAGER' }).expect(201)).body.token;
        await put(c.id, s);
        const res = await http().post(`/api/invitations/${token}/accept`).send({ fullName: 'TA Late', password: 'password123' });
        expect([s, code(res)]).toEqual([s, s === 'SUSPENDED' ? 'CENTER_SUSPENDED' : s === 'LOCKED' ? 'TRIAL_LOCKED' : 'TRIAL_READ_ONLY']);
      }
    });

    it("the students' AI tutor: the trial's daily allowance, and nothing once the trial is over", async () => {
      process.env.TRIAL_AI_PER_DAY = '2';
      const tutor = app.get(StudentTutorService);
      const ai = app.get(AiService);
      vi.spyOn(ai, 'isConfigured', 'get').mockReturnValue(true);
      const reply = vi.spyOn(ai, 'tutorReply').mockResolvedValue('javob');
      const c = await center();
      const st = (await http().post('/api/students').set(bearer(c.token)).send({ fullName: 'TA Tutor', phone: `+99894${tail}01` }).expect(201)).body;
      const s = { id: st.id, tenantId: c.id, fullName: 'TA Tutor', tenant: { name: 'TA', studentAiDailyLimit: 50, timezone: 'Asia/Tashkent' } };
      expect((await tutor.ask(s, 'savol 1')).status).toBe('ok');
      expect((await tutor.ask(s, 'savol 2')).status).toBe('ok');
      expect((await tutor.ask(s, 'savol 3')).status).toBe('limit');
      expect(reply).toHaveBeenCalledTimes(2);
      await put(c.id, 'LOCKED');
      expect((await tutor.ask(s, 'savol 4')).status).toBe('off');
      await put(c.id, 'ACTIVE');
      expect((await tutor.ask(s, 'savol 5')).status).toBe('ok'); // a paying center: only its own limit
      process.env.TRIAL_AI_PER_DAY = '20';
    });
  });

  it("mock-test AI marking for a student's submission: the center's trial allowance, none once closed", async () => {
    process.env.TRIAL_AI_PER_DAY = '1';
    const mock = app.get(MockTestsService) as any;
    const c = await center();
    expect(await mock.centerAiAllowed(c.id)).toBe(true);
    expect(await mock.centerAiAllowed(c.id)).toBe(false); // the day's one is used
    await put(c.id, 'ACTIVE');
    expect(await mock.centerAiAllowed(c.id)).toBe(true); // a paying center is not counted
    await put(c.id, 'SUSPENDED');
    expect(await mock.centerAiAllowed(c.id)).toBe(false);
    process.env.TRIAL_AI_PER_DAY = '20';
  });

  describe("SMS on the platform's account", () => {
    it('never for a center that is gone, on a plan the platform does not list, suspended or locked', async () => {
      expect(await notifications.smsRoute('no-such-center')).toMatchObject({ ok: false });
      const c = await center();
      await db.update(tenants).set({ smsEnabled: true }).where(eq(tenants.id, c.id));
      expect(await notifications.smsRoute(c.id)).toMatchObject({ ok: true });
      await db.update(tenants).set({ plan: `NOPLAN-${tail}` }).where(eq(tenants.id, c.id));
      expect(await notifications.smsRoute(c.id)).toMatchObject({ ok: false, reason: 'NOT_IN_PLAN' });
      await db.update(tenants).set({ plan: 'STARTER' }).where(eq(tenants.id, c.id));
      await put(c.id, 'SUSPENDED');
      expect(await notifications.smsRoute(c.id)).toMatchObject({ ok: false, reason: 'CENTER_INACTIVE' });
      await put(c.id, 'LOCKED');
      expect(await notifications.smsRoute(c.id)).toMatchObject({ ok: false, reason: 'CENTER_INACTIVE' });
    });

    const sms = async () => {
      const c = await center();
      await db.update(tenants).set({ smsEnabled: true, status: 'ACTIVE' }).where(eq(tenants.id, c.id));
      return c;
    };
    const msg = (key?: string) => ({ channel: 'SMS' as const, recipient: '+998901234567', content: 'test', idempotencyKey: key });

    it('a monthly budget per center, reserved atomically: parallel sends cannot pass it', async () => {
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '3';
      const provider = vi.spyOn(EskizProvider.prototype, 'sendSms').mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { success: true, messageId: 'm' };
      });
      const c = await sms();
      const results = await Promise.all(Array.from({ length: 8 }, () => notifications.send(c.id, msg())));
      expect(provider).toHaveBeenCalledTimes(3);
      expect(results.filter((r) => r.status === 'SENT')).toHaveLength(3);
      expect(results.filter((r) => r.status === 'FAILED' && (r.errorMessage ?? '').startsWith('SMS_QUOTA'))).toHaveLength(5);
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '1000';
    });

    it('the same message twice (a retry, a double click) goes once', async () => {
      const provider = vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValue({ success: true, messageId: 'm' });
      const c = await sms();
      await Promise.all([notifications.send(c.id, msg('k1')), notifications.send(c.id, msg('k1'))]);
      await notifications.send(c.id, msg('k1'));
      expect(provider).toHaveBeenCalledTimes(1);
    });

    it('a provider timeout is not retried blindly; a clear refusal may be, and gives the budget back', async () => {
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '1';
      const c = await sms();
      // Timed out: the provider may have sent it.
      let provider = vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValue({ success: false, error: 'timeout', uncertain: true });
      expect((await notifications.send(c.id, msg('t1'))).status).toBe('FAILED');
      expect((await notifications.send(c.id, msg('t1'))).errorMessage).toMatch(/^SMS_DUPLICATE/);
      expect(provider).toHaveBeenCalledTimes(1);
      // ... and it still counts against the budget.
      expect((await notifications.send(c.id, msg('t2'))).errorMessage).toMatch(/^SMS_QUOTA/);
      vi.restoreAllMocks();
      // A clear refusal: the budget comes back, the same key may try again.
      const d = await sms();
      provider = vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValueOnce({ success: false, error: 'HTTP 400' }).mockResolvedValue({ success: true, messageId: 'm' });
      expect((await notifications.send(d.id, msg('r1'))).status).toBe('FAILED');
      expect((await notifications.send(d.id, msg('r1'))).status).toBe('SENT');
      expect(provider).toHaveBeenCalledTimes(2);
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '1000';
    });

    it('a center with its own provider token is not charged to the platform budget', async () => {
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '1';
      vi.spyOn(EskizProvider.prototype, 'sendSms').mockResolvedValue({ success: true, messageId: 'm' });
      const c = await sms();
      await db.update(tenants).set({ smsApiToken: 'center-own-token' }).where(eq(tenants.id, c.id));
      const r = await Promise.all([notifications.send(c.id, msg()), notifications.send(c.id, msg())]);
      expect(r.map((x) => x.status)).toEqual(['SENT', 'SENT']);
      process.env.PLATFORM_SMS_PER_CENTER_MONTH = '1000';
    });
  });

  describe('background reminders', () => {
    it('skip centers whose trial is over (and suspended ones)', async () => {
      const reminders = app.get(RemindersService);
      const active = await center();
      const locked = await center();
      const ro = await center();
      await put(locked.id, 'LOCKED');
      await put(ro.id, 'READ_ONLY');
      const seen: string[] = [];
      vi.spyOn(reminders, 'paymentReminders').mockImplementation(async (t) => {
        seen.push(t.id);
        return 0;
      });
      vi.spyOn(reminders, 'lessonReminders').mockResolvedValue(0);
      vi.spyOn(reminders, 'dailyDigests').mockResolvedValue(0);
      await reminders.scan();
      expect(seen).toContain(active.id);
      expect(seen).not.toContain(locked.id);
      expect(seen).not.toContain(ro.id);
    });
  });
});
