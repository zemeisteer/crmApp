import { Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { noticeOutbox } from '../db/schema';
import { EmailService } from '../email/email.service';
import { TelegramService } from '../telegram/telegram.service';

export const MAX_ATTEMPTS = 6;
const LOCK_MS = 5 * 60_000;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 3_600_000;

type Tx = Pick<Database, 'insert'>;
type Row = typeof noticeOutbox.$inferSelect;

export interface Notice {
  tenantId: string | null;
  kind: string;
  channel: 'TELEGRAM' | 'EMAIL';
  recipient: string;
  subject?: string;
  body: string;
  /** One message per occasion and recipient: the same key twice is one row. */
  dedupeKey: string;
}

/** An error text fit for the database and the logs: no addresses, no long bodies. */
export const scrubError = (e: string | undefined) => (e ?? 'not accepted').replace(/[^\s<>"']+@[^\s<>"']+/g, '<address>').slice(0, 200);

/**
 * Payment messages through an outbox. enqueue() writes them in the caller's
 * transaction - a rollback leaves none, a commit always has them - and the
 * worker sends them afterwards:
 *
 *  - due rows are claimed with FOR UPDATE SKIP LOCKED: two workers (two
 *    processes, or a timer and a kick) never take the same row;
 *  - a claim holds the row for LOCK_MS; a worker that died mid-send leaves it
 *    to be taken again after that (so a message may arrive twice: at least
 *    once, not exactly once);
 *  - a failure is retried with a growing delay, MAX_ATTEMPTS in all, then
 *    the row is FAILED and kept (GET /api/platform/notice-outbox) until a
 *    platform admin retries it;
 *  - each recipient and channel is its own row: one failure holds back nobody else;
 *  - mail carries the row id as the provider's Idempotency-Key (Resend
 *    honours it); Telegram and SMTP have none, see the at-least-once note;
 *  - logs carry ids, kinds and error codes only - never the text, the
 *    recipient or a token.
 */
@Injectable()
export class NoticeOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('NoticeOutbox');
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private again = false;
  /** Tests stop the after-commit kick to play "the process stopped after the commit". */
  paused = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    const ms = Number(process.env.NOTICE_OUTBOX_POLL_MS ?? 15_000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    // A restart picks up whatever was committed and not yet sent.
    this.timer = setInterval(() => void this.kick(), ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** In the caller's transaction. Returns nothing: the commit is the promise. */
  async enqueue(tx: Tx, notices: Notice[]) {
    const rows = notices.filter((n) => n.recipient && n.body);
    if (rows.length === 0) return;
    await tx
      .insert(noticeOutbox)
      .values(rows.map((n) => ({ tenantId: n.tenantId, kind: n.kind, channel: n.channel, recipient: n.recipient, subject: n.subject ?? null, body: n.body, dedupeKey: n.dedupeKey })))
      .onConflictDoNothing({ target: noticeOutbox.dedupeKey });
  }

  /**
   * After a commit: send what is due now, in the background. Never throws.
   * Coalesced: a kick while a pass runs makes one more pass after it.
   */
  kick(): Promise<void> {
    if (this.paused) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running.then(() => undefined);
    }
    const loop = async () => {
      do {
        this.again = false;
        await this.runOnce().catch((err: Error) => this.logger.warn(`pass failed: ${err.message}`));
      } while (this.again);
    };
    this.running = loop().finally(() => (this.running = null));
    return this.running.then(() => undefined);
  }

  /** Waits for a pass in progress (tests, shutdown). */
  async drain() {
    while (this.running) await this.running;
  }

  /** One pass: claims up to `limit` due rows and sends each. */
  async runOnce(now: Date = new Date(), limit = 50) {
    const claimed = await this.claim(now, limit);
    const out = { sent: 0, retried: 0, failed: 0 };
    for (const row of claimed) {
      const r = await this.send(row);
      if (r.ok) {
        out.sent++;
        await this.db
          .update(noticeOutbox)
          .set({ status: 'SENT', sentAt: new Date(), providerMessageId: r.messageId ?? null, lockedUntil: null, lastError: null })
          .where(and(eq(noticeOutbox.id, row.id), eq(noticeOutbox.status, 'SENDING'), eq(noticeOutbox.attempts, row.attempts)));
        continue;
      }
      const last = r.permanent || row.attempts >= MAX_ATTEMPTS;
      const error = scrubError(r.error);
      if (last) out.failed++;
      else out.retried++;
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (row.attempts - 1));
      // Fenced by the attempt: a worker whose hold ran out never overwrites the next one's result.
      await this.db
        .update(noticeOutbox)
        .set({ status: last ? 'FAILED' : 'PENDING', lastError: error, lockedUntil: null, nextAttemptAt: new Date(now.getTime() + delay) })
        .where(and(eq(noticeOutbox.id, row.id), eq(noticeOutbox.status, 'SENDING'), eq(noticeOutbox.attempts, row.attempts)));
      this.logger.warn(`notice ${row.id} (${row.kind}, ${row.channel}) attempt ${row.attempts} ${last ? 'failed for good' : 'will be retried'}: ${error}`);
    }
    return out;
  }

  private async claim(now: Date, limit: number): Promise<Row[]> {
    const at = now.toISOString();
    const res = await this.db.execute(sql`
      update ${noticeOutbox}
         set status = 'SENDING', locked_until = ${new Date(now.getTime() + LOCK_MS).toISOString()}::timestamp, attempts = attempts + 1
       where id in (
         select id from ${noticeOutbox}
          where (status = 'PENDING' and next_attempt_at <= ${at}::timestamp)
             or (status = 'SENDING' and locked_until < ${at}::timestamp)
          order by next_attempt_at, id
          limit ${limit}
          for update skip locked)
      returning id`);
    const ids = (res.rows as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return [];
    return this.db.select().from(noticeOutbox).where(inArray(noticeOutbox.id, ids)).orderBy(noticeOutbox.createdAt, noticeOutbox.id);
  }

  private async send(row: Row): Promise<{ ok: boolean; messageId?: string; error?: string; permanent?: boolean }> {
    try {
      if (row.channel === 'TELEGRAM') return await this.telegram.deliverMessage(row.recipient, row.body);
      if (row.channel === 'EMAIL') {
        const r = await this.email.deliver(row.recipient, row.subject ?? 'TalimCRM', row.body, `outbox-${row.id}`);
        return { ok: r.accepted, messageId: r.providerMessageId, error: r.error, permanent: r.error === 'NOT_CONFIGURED' };
      }
      return { ok: false, error: `unknown channel ${row.channel}`, permanent: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ---- the platform admin ----

  async list(q: { status?: string; page?: number; pageSize?: number }) {
    const status = q.status && ['PENDING', 'SENDING', 'SENT', 'FAILED'].includes(q.status) ? q.status : 'FAILED';
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize) || 50)));
    const page = Math.max(1, Math.trunc(Number(q.page) || 1));
    const [rows, [{ total }], counts] = await Promise.all([
      this.db
        .select({
          id: noticeOutbox.id,
          tenantId: noticeOutbox.tenantId,
          kind: noticeOutbox.kind,
          channel: noticeOutbox.channel,
          status: noticeOutbox.status,
          attempts: noticeOutbox.attempts,
          lastError: noticeOutbox.lastError,
          nextAttemptAt: noticeOutbox.nextAttemptAt,
          sentAt: noticeOutbox.sentAt,
          createdAt: noticeOutbox.createdAt,
        })
        .from(noticeOutbox)
        .where(eq(noticeOutbox.status, status))
        .orderBy(desc(noticeOutbox.createdAt), desc(noticeOutbox.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(noticeOutbox).where(eq(noticeOutbox.status, status)),
      this.db.select({ status: noticeOutbox.status, n: sql<number>`count(*)::int` }).from(noticeOutbox).groupBy(noticeOutbox.status),
    ]);
    // Recipient and text stay out of the list: an id and an error are enough to act on.
    return { status, page, pageSize, total, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), items: rows };
  }

  /** A FAILED message goes back to the queue with a fresh set of attempts. */
  async retry(id: string) {
    const [row] = await this.db
      .update(noticeOutbox)
      .set({ status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lockedUntil: null })
      .where(and(eq(noticeOutbox.id, id), eq(noticeOutbox.status, 'FAILED')))
      .returning({ id: noticeOutbox.id });
    if (!row) throw new NotFoundException("Bunday yuborilmagan xabar topilmadi");
    void this.kick();
    return { id, status: 'PENDING' };
  }
}
