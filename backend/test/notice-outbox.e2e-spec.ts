import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { eq, inArray } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, Database } from '../src/db/db.module.js';
import { noticeOutbox, users } from '../src/db/schema.js';
import { MAX_ATTEMPTS, Notice, NoticeOutboxService } from '../src/notice-outbox/notice-outbox.service.js';
import { TelegramService } from '../src/telegram/telegram.service.js';
import { EmailService } from '../src/email/email.service.js';

// The payment message outbox on PostgreSQL: rows exist exactly when their
// transaction commits, a restart sends what was committed, provider
// failures are retried with a delay up to a limit and then kept as FAILED
// for the platform admin, two workers never send one row, one recipient's
// failure holds back nobody else, and nothing personal reaches the logs.
describe('Payment message outbox (e2e)', () => {
  let app: INestApplication<App>;
  let db: Database;
  let outbox: NoticeOutboxService;
  let tg: TelegramService;
  let mail: EmailService;
  let tenantId: string;
  let sa: Record<string, string>;
  let owner: Record<string, string>;
  const suffix = Date.now();
  const http = () => request(app.getHttpServer());
  // The provider, as the tests script it: by chat id, a list of answers.
  let script: Record<string, Array<{ ok: boolean; error?: string; permanent?: boolean; delayMs?: number }>> = {};
  const sent: Array<{ chat: string; text: string }> = [];
  const mails: Array<{ to: string; key?: string }> = [];
  const logged: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('api');
    await app.init();
    db = app.get(DB);
    outbox = app.get(NoticeOutboxService);
    tg = app.get(TelegramService);
    mail = app.get(EmailService);
    tg.deliverMessage = (async (chat: string, text: string) => {
      const next = script[chat]?.shift() ?? { ok: true };
      if (next.delayMs) await new Promise((r) => setTimeout(r, next.delayMs));
      if (next.ok) sent.push({ chat, text });
      return next.ok ? { ok: true, messageId: String(sent.length) } : { ok: false, error: next.error, permanent: next.permanent };
    }) as typeof tg.deliverMessage;
    mail.deliver = (async (to: string, _s: string, _t: string, key?: string) => {
      mails.push({ to, key });
      return { accepted: true, providerMessageId: `m${mails.length}` };
    }) as typeof mail.deliver;
    for (const level of ['warn', 'log', 'error'] as const) {
      const orig = Logger.prototype[level];
      vi.spyOn(Logger.prototype, level).mockImplementation(function (this: Logger, msg: unknown, ...rest: unknown[]) {
        logged.push(String(msg));
        return orig.call(this, msg, ...rest);
      });
    }

    const reg = (await http().post('/api/auth/register')
      .send({ centerName: `Outbox ${suffix}`, subdomain: `obx-${suffix}`, email: `obx-${suffix}@test.uz`, password: 'password123', fullName: 'Outbox Owner' })
      .expect(201)).body;
    tenantId = reg.tenant?.id ?? reg.user.tenantId;
    owner = { Authorization: `Bearer ${reg.accessToken}` };
    const s = (await http().post('/api/auth/register')
      .send({ centerName: `ObxSa ${suffix}`, subdomain: `obxsa-${suffix}`, email: `obxsa-${suffix}@test.uz`, password: 'password123', fullName: 'Outbox Admin' })
      .expect(201)).body;
    await db.update(users).set({ role: 'SUPERADMIN' }).where(eq(users.id, s.user.id));
    sa = { Authorization: `Bearer ${(await http().post('/api/auth/login').send({ email: `obxsa-${suffix}@test.uz`, password: 'password123' }).expect(201)).body.accessToken}` };
    outbox.onlyTenants = [tenantId];
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  let n = 0;
  const notice = (chat: string, extra: Partial<Notice> = {}): Notice => ({
    tenantId,
    kind: 'test.outbox',
    channel: 'TELEGRAM',
    recipient: chat,
    body: `Maxfiy matn ${chat}`,
    dedupeKey: `test.outbox:${suffix}:${++n}:${chat}`,
    ...extra,
  });
  const rowsOf = (keys: string[]) => db.select().from(noticeOutbox).where(inArray(noticeOutbox.dedupeKey, keys));
  const at = (minutes: number) => new Date(Date.now() + minutes * 60_000);

  it('a rolled-back transaction leaves no message; a committed one always has it', async () => {
    const lost = notice('9001');
    await expect(db.transaction(async (tx) => {
      await outbox.enqueue(tx, [lost]);
      throw new Error('the change failed');
    })).rejects.toThrow('the change failed');
    expect(await rowsOf([lost.dedupeKey])).toHaveLength(0);

    const kept = notice('9002');
    await db.transaction((tx) => outbox.enqueue(tx, [kept, kept]));
    expect(await rowsOf([kept.dedupeKey])).toEqual([expect.objectContaining({ status: 'PENDING', attempts: 0 })]);
    // Enqueued again (a retried request): still one.
    await db.transaction((tx) => outbox.enqueue(tx, [kept]));
    expect(await rowsOf([kept.dedupeKey])).toHaveLength(1);
  });

  it('after a restart, a new worker sends what was committed and not sent', async () => {
    const k = notice('9003');
    await db.transaction((tx) => outbox.enqueue(tx, [k]));
    // "A restart": a fresh worker with nothing in memory.
    const restarted = new NoticeOutboxService(db, tg, mail);
    restarted.onlyTenants = [tenantId];
    const r = await restarted.runOnce();
    expect(r.sent).toBeGreaterThanOrEqual(1);
    expect(await rowsOf([k.dedupeKey])).toEqual([expect.objectContaining({ status: 'SENT', attempts: 1 })]);
    expect(sent.filter((s) => s.chat === '9003')).toHaveLength(1);
    // A worker that took a row and died: its hold runs out, the next one sends it.
    const stuck = notice('9004');
    await db.transaction((tx) => outbox.enqueue(tx, [stuck]));
    await db.update(noticeOutbox).set({ status: 'SENDING', attempts: 1, lockedUntil: new Date(Date.now() - 1000) }).where(eq(noticeOutbox.dedupeKey, stuck.dedupeKey));
    await restarted.runOnce();
    expect(await rowsOf([stuck.dedupeKey])).toEqual([expect.objectContaining({ status: 'SENT', attempts: 2 })]);
  });

  it('a provider timeout or 503 is retried later, with a growing delay, until it goes through', async () => {
    script['9005'] = [{ ok: false, error: 'telegram: timeout' }, { ok: false, error: 'telegram 503: Service Unavailable' }];
    const k = notice('9005');
    await db.transaction((tx) => outbox.enqueue(tx, [k]));
    await outbox.runOnce(at(0));
    let [row] = await rowsOf([k.dedupeKey]);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'telegram: timeout' });
    const firstDelay = row.nextAttemptAt.getTime() - Date.now();
    // Not due yet: nothing happens.
    await outbox.runOnce(at(0));
    expect((await rowsOf([k.dedupeKey]))[0].attempts).toBe(1);
    await outbox.runOnce(at(2));
    [row] = await rowsOf([k.dedupeKey]);
    expect(row).toMatchObject({ status: 'PENDING', attempts: 2 });
    expect(row.nextAttemptAt.getTime() - at(2).getTime()).toBeGreaterThan(firstDelay);
    await outbox.runOnce(at(10));
    expect(await rowsOf([k.dedupeKey])).toEqual([expect.objectContaining({ status: 'SENT', attempts: 3, lastError: null })]);
    expect(sent.filter((s) => s.chat === '9005')).toHaveLength(1);
  });

  it('after the last attempt the message is FAILED and kept; the platform admin sees it and sends it again', async () => {
    script['9006'] = Array.from({ length: MAX_ATTEMPTS }, () => ({ ok: false, error: 'telegram 503' }));
    const k = notice('9006');
    await db.transaction((tx) => outbox.enqueue(tx, [k]));
    for (let i = 0; i < MAX_ATTEMPTS; i++) await outbox.runOnce(at(120 * (i + 1)));
    const [row] = await rowsOf([k.dedupeKey]);
    expect(row).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
    await outbox.runOnce(at(100_000));
    expect((await rowsOf([k.dedupeKey]))[0].attempts).toBe(MAX_ATTEMPTS);

    await http().get('/api/platform/notice-outbox?status=FAILED').set(owner).expect(403);
    const list = (await http().get('/api/platform/notice-outbox?status=FAILED&pageSize=100').set(sa).expect(200)).body;
    const item = list.items.find((i: { id: string }) => i.id === row.id);
    expect(item).toMatchObject({ kind: 'test.outbox', channel: 'TELEGRAM', lastError: 'telegram 503' });
    // The list names no recipient and no text.
    expect(JSON.stringify(list)).not.toContain('Maxfiy matn');
    expect(item.recipient).toBeUndefined();
    await http().post(`/api/platform/notice-outbox/${row.id}/retry`).set(owner).expect(403);
    outbox.paused = true; // the retry's kick would race the explicit pass below
    try {
      await http().post(`/api/platform/notice-outbox/${row.id}/retry`).set(sa).expect(201);
    } finally {
      outbox.paused = process.env.NODE_ENV === 'test';
    }
    await http().post(`/api/platform/notice-outbox/${row.id}/retry`).set(sa).expect(404); // not FAILED any more
    await outbox.runOnce();
    expect(await rowsOf([k.dedupeKey])).toEqual([expect.objectContaining({ status: 'SENT', attempts: 1 })]);
  });

  it('a recipient refused for good fails at once; the others in the same batch are sent', async () => {
    script['9007'] = [{ ok: false, error: 'telegram 403: Forbidden: bot was blocked by the user', permanent: true }];
    const ks = [notice('9007'), notice('9008'), notice('obx@example.uz', { channel: 'EMAIL', subject: 'S' })];
    await db.transaction((tx) => outbox.enqueue(tx, ks));
    await outbox.runOnce();
    const rows = await rowsOf(ks.map((k) => k.dedupeKey));
    const by = (r: string) => rows.find((x) => x.recipient === r)!;
    expect(by('9007')).toMatchObject({ status: 'FAILED', attempts: 1 });
    expect(by('9008').status).toBe('SENT');
    expect(by('obx@example.uz').status).toBe('SENT');
    // Mail carries the row's id as the provider's idempotency key.
    expect(mails.find((m) => m.to === 'obx@example.uz')!.key).toBe(`outbox-${by('obx@example.uz').id}`);
  });

  it('two workers at once never send one message twice', async () => {
    const ks = Array.from({ length: 12 }, (_, i) => notice(`91${String(i).padStart(2, '0')}`));
    for (const k of ks) script[k.recipient] = [{ ok: true, delayMs: 30 }];
    await db.transaction((tx) => outbox.enqueue(tx, ks));
    const a = new NoticeOutboxService(db, tg, mail);
    const b = new NoticeOutboxService(db, tg, mail);
    a.onlyTenants = b.onlyTenants = [tenantId];
    const [ra, rb] = await Promise.all([a.runOnce(), b.runOnce()]);
    expect(ra.sent + rb.sent).toBe(12);
    for (const k of ks) expect(sent.filter((s) => s.chat === k.recipient)).toHaveLength(1);
    expect((await rowsOf(ks.map((k) => k.dedupeKey))).every((r) => r.status === 'SENT' && r.attempts === 1)).toBe(true);
  });

  it('the logs name ids and errors, never the text, the recipient or an address', async () => {
    const all = logged.join('\n');
    expect(all).toContain('test.outbox');
    expect(all).not.toContain('Maxfiy matn');
    expect(all).not.toMatch(/\b9006\b|\b9007\b/);
    expect(all).not.toContain('obx@example.uz');
  });
});
