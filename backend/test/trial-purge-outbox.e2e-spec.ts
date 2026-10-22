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
import { auditLogs, organizationMemberships, platformSubscriptions, students, tenants, trialNotices } from '../src/db/schema.js';
import { EmailService } from '../src/email/email.service.js';
import { TrialLifecycleService } from '../src/trial/trial-lifecycle.service.js';

// The deletion of unpaid trials that ended long ago (TRIAL_PURGE): the two
// notices go through an outbox and count only once the mail provider took
// them; nothing is deleted on a failed or impossible notice; the deletion
// checks everything again under a lock (payment, extension, two workers).
// No mail leaves the machine: EmailService.deliver is replaced in each test.
describe('Trial deletion outbox (e2e)', () => {
  let app: NestExpressApplication;
  let db: Database;
  let lifecycle: TrialLifecycleService;
  let email: EmailService;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer() as App);
  const DAY = 86_400_000;
  const before = { TRIAL_PURGE: process.env.TRIAL_PURGE, TRIAL_PURGE_DAYS: process.env.TRIAL_PURGE_DAYS };
  let n = 0;

  type Sent = { to: string; subject: string; text: string; key?: string };
  let sent: Sent[] = [];
  const accept = () =>
    vi.spyOn(email, 'deliver').mockImplementation(async (to, subject, text, key) => {
      sent.push({ to, subject, text, key });
      return { accepted: true, providerMessageId: `msg-${sent.length}` };
    });
  const refuse = (error = 'resend 503') =>
    vi.spyOn(email, 'deliver').mockImplementation(async (to, subject, text, key) => {
      sent.push({ to, subject, text, key });
      return { accepted: false, error };
    });

  /** A center whose trial ended `endedDaysAgo` days before `now`, with one student. */
  const center = async (now: number, endedDaysAgo = 47) => {
    const key = `po${++n}${String(suffix).slice(-5)}`;
    const body = (await http().post('/api/auth/register').send({ centerName: `PO ${key}`, subdomain: key, email: `${key}@test.uz`, password: 'password123', fullName: `Owner ${key}` }).expect(201)).body;
    await http().post('/api/students').set({ Authorization: `Bearer ${body.accessToken}` }).send({ fullName: `PO Student ${key}`, phone: `+99891${String(suffix).slice(-4)}${String(n).padStart(3, '0')}` }).expect(201);
    const id = body.tenant.id as string;
    await db.update(tenants).set({ trialEndsAt: new Date(now - endedDaysAgo * DAY) }).where(eq(tenants.id, id));
    return { id, email: `${key}@test.uz` };
  };
  const tenant = async (id: string) => (await db.select().from(tenants).where(eq(tenants.id, id)))[0];
  const notices = (id: string) => db.select().from(trialNotices).where(eq(trialNotices.tenantId, id));
  const exists = async (id: string) => !!(await tenant(id));

  /** Runs the passes a working scanner would: first notice, last notice, the deletion. */
  const toTheEnd = async (id: string, now: number) => {
    await lifecycle.run(new Date(now), [id]);
    const t = await tenant(id);
    await lifecycle.run(new Date(t.trialPurgeOn!.getTime() - 7 * DAY), [id]);
    return (await tenant(id)).trialPurgeOn!;
  };

  beforeAll(async () => {
    Object.assign(process.env, { TRIAL_PURGE: 'on', TRIAL_PURGE_DAYS: '60' });
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }) })
      .compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    db = app.get<Database>(DB);
    lifecycle = app.get(TrialLifecycleService);
    email = app.get(EmailService);
  }, 120_000);

  beforeEach(() => {
    process.env.TRIAL_PURGE = 'on';
    sent = [];
  });
  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('with TRIAL_PURGE off nothing is sent or deleted; the preview still says what would happen', async () => {
    process.env.TRIAL_PURGE = 'off';
    const spy = accept();
    const now = Date.now();
    const c = await center(now, 400);
    expect(await lifecycle.run(new Date(now + 100 * DAY), [c.id])).toMatchObject({ warned: 0, deleted: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(await exists(c.id)).toBe(true);
    expect(await notices(c.id)).toEqual([]);
    const dry = await lifecycle.run(new Date(now), [c.id], { dryRun: true });
    expect(dry.report).toEqual([expect.objectContaining({ tenantId: c.id, state: 'FIRST_NOTICE_PENDING' })]);
    expect(spy).not.toHaveBeenCalled();
    expect((await tenant(c.id)).trialPurgeOn).toBeNull(); // the preview wrote nothing
  });

  it('the mail provider is down: retried with backoff, never counted, never deleted; the last failure is final', async () => {
    refuse();
    const now = Date.now();
    const c = await center(now);
    // Every pass for half a year: five attempts, then FAILED.
    for (let d = 0; d <= 180; d += 1) await lifecycle.run(new Date(now + d * DAY), [c.id]);
    const [notice] = await notices(c.id);
    expect(notice).toMatchObject({ kind: 'FIRST', recipient: c.email, status: 'FAILED', attempts: 5, lastError: 'resend 503' });
    expect(sent).toHaveLength(5);
    const t = await tenant(c.id);
    expect(t.trialWarnedAt).toBeNull();
    expect(await exists(c.id)).toBe(true);
    const dry = await lifecycle.run(new Date(now + 200 * DAY), [c.id], { dryRun: true });
    expect(dry.report[0].state).toBe('FIRST_NOTICE_FAILED');
  });

  it('no mail provider configured (the real deliver): nothing counts, nothing is deleted', async () => {
    const now = Date.now();
    const c = await center(now);
    for (let d = 0; d <= 60; d += 1) await lifecycle.run(new Date(now + d * DAY), [c.id]);
    expect(await exists(c.id)).toBe(true);
    expect((await notices(c.id))[0]).toMatchObject({ status: 'FAILED', lastError: 'NOT_CONFIGURED' });
  });

  it('nobody to write to: no notice, no deletion, the report says why', async () => {
    const spy = accept();
    const now = Date.now();
    const c = await center(now);
    await db.update(organizationMemberships).set({ status: 'SUSPENDED' }).where(eq(organizationMemberships.tenantId, c.id));
    for (let d = 0; d <= 90; d += 5) await lifecycle.run(new Date(now + d * DAY), [c.id]);
    expect(spy).not.toHaveBeenCalled();
    expect(await exists(c.id)).toBe(true);
    const r = await lifecycle.run(new Date(now + 90 * DAY), [c.id]);
    expect(r.report[0]).toMatchObject({ state: 'NO_RECIPIENT' });
  });

  it('a worker dies while sending: the notice waits out the lock, then goes again with the same idempotency key', async () => {
    const now = Date.now();
    const c = await center(now);
    vi.spyOn(email, 'deliver').mockImplementationOnce(async (to, subject, text, key) => {
      sent.push({ to, subject, text, key });
      throw new Error('worker killed');
    });
    await expect(lifecycle.run(new Date(now), [c.id])).rejects.toThrow('worker killed');
    expect((await notices(c.id))[0]).toMatchObject({ status: 'SENDING', attempts: 1 });
    vi.restoreAllMocks();
    accept();
    // Inside the lock nobody sends it again ...
    await lifecycle.run(new Date(now + 60_000), [c.id]);
    expect(sent).toHaveLength(1);
    expect((await tenant(c.id)).trialWarnedAt).toBeNull();
    // ... after it, it goes - with the key the provider dedupes on.
    await lifecycle.run(new Date(now + 10 * 60_000), [c.id]);
    expect(sent).toHaveLength(2);
    expect(sent[1].key).toBe(sent[0].key);
    expect((await notices(c.id))[0]).toMatchObject({ status: 'ACCEPTED', attempts: 2, providerMessageId: 'msg-2' });
    expect((await tenant(c.id)).trialWarnedAt).not.toBeNull();
  });

  it('two workers at once: each notice goes once, the center is deleted once', async () => {
    const now = Date.now();
    const c = await center(now);
    vi.spyOn(email, 'deliver').mockImplementation(async (to, subject, text, key) => {
      sent.push({ to, subject, text, key });
      await new Promise((r) => setTimeout(r, 150));
      return { accepted: true, providerMessageId: `msg-${sent.length}` };
    });
    await Promise.all([lifecycle.run(new Date(now), [c.id]), lifecycle.run(new Date(now), [c.id])]);
    expect(sent).toHaveLength(1);
    const purgeOn = (await tenant(c.id)).trialPurgeOn!;
    const finalAt = new Date(purgeOn.getTime() - 7 * DAY);
    await Promise.all([lifecycle.run(finalAt, [c.id]), lifecycle.run(finalAt, [c.id])]);
    expect(sent).toHaveLength(2);
    const [a, b] = await Promise.all([lifecycle.run(purgeOn, [c.id]), lifecycle.run(purgeOn, [c.id])]);
    expect([...a.deletedIds, ...b.deletedIds]).toEqual([c.id]);
    expect(await exists(c.id)).toBe(false);
    const logs = await db.select().from(auditLogs).where(and(eq(auditLogs.action, 'trial_purge'), eq(auditLogs.entityId, c.id)));
    expect(logs).toHaveLength(1);
  });

  it('the date in the mail is the date of the deletion, and nothing goes before it', async () => {
    accept();
    const now = Date.now();
    const c = await center(now);
    await lifecycle.run(new Date(now), [c.id]);
    // The scanner was down for three weeks: the last notice moves the date
    // to a week after itself, and says so.
    const late = now + 21 * DAY;
    await lifecycle.run(new Date(late), [c.id]);
    const purgeOn = (await tenant(c.id)).trialPurgeOn!;
    expect(purgeOn.getTime()).toBe(late + 7 * DAY);
    const final = sent.find((m) => m.subject.includes("o'chiriladi"))!;
    const day = purgeOn.toISOString().slice(0, 10);
    expect(final.subject).toContain(day);
    expect(final.text).toContain(day);
    expect((await lifecycle.run(new Date(purgeOn.getTime() - 1), [c.id])).deleted).toBe(0);
    expect((await lifecycle.run(purgeOn, [c.id])).deletedIds).toEqual([c.id]);
    expect(await db.select().from(students).where(eq(students.tenantId, c.id))).toEqual([]);
  });

  it('a payment that lands while the deletion runs keeps the center (checked again under the lock)', async () => {
    accept();
    const now = Date.now();
    const c = await center(now);
    const purgeOn = await toTheEnd(c.id, now);
    const real = (lifecycle as any).deleteIfStillDue.bind(lifecycle);
    vi.spyOn(lifecycle as any, 'deleteIfStillDue').mockImplementationOnce(async (...args: unknown[]) => {
      // The scan saw no payment; it arrives before the deletion's transaction.
      await db.insert(platformSubscriptions).values({ tenantId: c.id, plan: 'STANDARD', amount: 1, forMonth: '2026-10', status: 'PAID', paidAt: new Date() });
      return real(...args);
    });
    const r = await lifecycle.run(purgeOn, [c.id]);
    expect(r.deleted).toBe(0);
    expect(r.report[0].state).toBe('KEPT');
    expect(await exists(c.id)).toBe(true);
    // And with the payment on record the center is no longer a candidate.
    expect((await lifecycle.run(new Date(purgeOn.getTime() + 30 * DAY), [c.id])).report).toEqual([]);
  });

  it('a trial extended while the deletion runs keeps the center; the old cycle ends', async () => {
    accept();
    const now = Date.now();
    const c = await center(now);
    const purgeOn = await toTheEnd(c.id, now);
    const real = (lifecycle as any).deleteIfStillDue.bind(lifecycle);
    vi.spyOn(lifecycle as any, 'deleteIfStillDue').mockImplementationOnce(async (...args: unknown[]) => {
      await db.update(tenants).set({ trialEndsAt: new Date(purgeOn.getTime() + 14 * DAY) }).where(eq(tenants.id, c.id));
      return real(...args);
    });
    expect((await lifecycle.run(purgeOn, [c.id])).deleted).toBe(0);
    expect(await exists(c.id)).toBe(true);
    // The next pass sees the change: notices and dates of the old cycle go.
    const r = await lifecycle.run(new Date(purgeOn.getTime() + DAY), [c.id]);
    expect(r.report[0].state).toBe('TRIAL_CHANGED');
    const t = await tenant(c.id);
    expect(t).toMatchObject({ trialPurgeOn: null, trialPurgeBasis: null, trialWarnedAt: null, trialFinalWarnedAt: null });
    expect(await notices(c.id)).toEqual([]);
  });

  it('a trial extended between the notices: no deletion on the old date', async () => {
    accept();
    const now = Date.now();
    const c = await center(now);
    await lifecycle.run(new Date(now), [c.id]);
    const purgeOn = (await tenant(c.id)).trialPurgeOn!;
    // The platform admin gives a month more.
    await db.update(tenants).set({ trialEndsAt: new Date(now + 30 * DAY) }).where(eq(tenants.id, c.id));
    for (const at of [purgeOn.getTime() - 7 * DAY, purgeOn.getTime(), purgeOn.getTime() + DAY]) await lifecycle.run(new Date(at), [c.id]);
    expect(await exists(c.id)).toBe(true);
    expect(sent).toHaveLength(1); // no last notice for a cycle that ended
  });

  it('the platform preview lists centers with reasons and changes nothing', async () => {
    accept();
    const now = Date.now();
    const c = await center(now);
    const r = await lifecycle.run(new Date(now), [c.id], { dryRun: true });
    expect(r.report).toEqual([expect.objectContaining({ tenantId: c.id, state: 'FIRST_NOTICE_PENDING', detail: '1 recipient(s)' })]);
    expect(sent).toEqual([]);
    expect(await notices(c.id)).toEqual([]);
    // Unauthenticated callers do not see it.
    await http().get('/api/platform/trial-purge/preview').expect(401);
  });
});
