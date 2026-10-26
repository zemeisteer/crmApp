import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, platformSubscriptions, signupPhoneCodes, tenants, trialNotices, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { trialRules } from './trial-rules';
import { TrialClaimsService } from './trial-claims.service';

const DAY = 86_400_000;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60_000;

type NoticeKind = 'FIRST' | 'FINAL';
type Tenant = typeof tenants.$inferSelect;

export interface PurgeReportRow {
  tenantId: string;
  name: string;
  subdomain: string;
  trialEndsAt: Date | null;
  purgeOn: Date | null;
  /** Where it stands and why (what a person reading the report needs). */
  state:
    | 'DELETED' | 'WOULD_DELETE' | 'NO_RECIPIENT' | 'TRIAL_CHANGED' | 'FIRST_NOTICE_PENDING' | 'FIRST_NOTICE_FAILED'
    | 'WAITING_FOR_FINAL' | 'FINAL_NOTICE_PENDING' | 'FINAL_NOTICE_FAILED' | 'WAITING' | 'KEPT';
  detail?: string;
}

/**
 * Unpaid trials that ended long ago (TRIAL_PURGE on; off by default, see
 * trial-rules.ts). Two e-mails go to the owners and admins - 14 and 7 days
 * before the deletion date they name - through an outbox: each is retried
 * until the provider takes it (ACCEPTED - which is not "read") or gives up
 * for good. The waiting periods count from accepted notices only: no
 * provider, a failed send or nobody to write to means no deletion.
 *
 * The deletion itself re-reads the center under a row lock: still on its
 * trial, the trial end the notices counted from, no payment, both notices
 * accepted, the named date reached. A trial extended since, or a payment,
 * cancels it (a later extension starts a new cycle). Workers at once: one
 * claims each notice, the row lock lets one delete.
 *
 * run(now, ids, { dryRun: true }) writes nothing and says, per center, what
 * would happen and why (GET /api/platform/trial-purge/preview).
 */
@Injectable()
export class TrialLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TrialLifecycle');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly claims: TrialClaimsService,
  ) {}

  onModuleInit() {
    const configured = process.env.TRIAL_SCAN_MS;
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.NODE_ENV !== 'production' && !configured) return;
    const ms = Number(configured ?? 6 * 3_600_000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.run()
        .then(async (r) => {
          if (r.warned || r.deleted) this.logger.log(`Trial notices accepted: ${r.warned}, centers deleted: ${r.deleted}`);
          // Sign-up codes are of no use after 30 days.
          await this.db.delete(signupPhoneCodes).where(lt(signupPhoneCodes.createdAt, new Date(Date.now() - 30 * DAY)));
        })
        .catch((err: Error) => this.logger.warn(`Trial pass failed: ${err.message}`))
        .finally(() => (this.running = false));
    }, ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date(), onlyTenants?: string[], opts: { dryRun?: boolean } = {}) {
    const rules = trialRules();
    const report: PurgeReportRow[] = [];
    const deletedIds: string[] = [];
    let warned = 0;
    if (!rules.purge && !opts.dryRun) return { warned, deleted: 0, deletedIds, report };
    const purgeAfter = rules.purgeDays * DAY;

    const candidates = await this.db
      .select()
      .from(tenants)
      .where(and(
        eq(tenants.status, 'TRIAL'),
        isNotNull(tenants.trialEndsAt),
        // Two weeks before the earliest deletion date, or already in a cycle.
        or(sql`${tenants.trialEndsAt} <= ${new Date(now.getTime() - purgeAfter + 14 * DAY).toISOString()}::timestamp`, isNotNull(tenants.trialPurgeOn)),
        sql`not exists (select 1 from ${platformSubscriptions} where ${platformSubscriptions.tenantId} = ${tenants.id} and ${platformSubscriptions.status} = 'PAID')`,
        onlyTenants ? inArray(tenants.id, onlyTenants) : undefined,
      ));

    for (const t of candidates) {
      const row = (state: PurgeReportRow['state'], detail?: string, purgeOn = t.trialPurgeOn) =>
        report.push({ tenantId: t.id, name: t.name, subdomain: t.subdomain, trialEndsAt: t.trialEndsAt, purgeOn, state, detail });

      // The trial was extended since the cycle began: the cycle ends.
      if (t.trialPurgeBasis && t.trialPurgeBasis.getTime() !== t.trialEndsAt!.getTime()) {
        if (!opts.dryRun) await this.resetCycle(t.id);
        row('TRIAL_CHANGED', 'the trial end changed after the notices began');
        continue;
      }

      // A cycle begins: the date, and the first notice to everyone who runs the center.
      if (!t.trialPurgeOn) {
        const recipients = await this.recipients(t.id);
        const purgeOn = new Date(Math.max(t.trialEndsAt!.getTime() + purgeAfter, now.getTime() + 14 * DAY));
        if (recipients.length === 0) {
          row('NO_RECIPIENT', 'no active owner or admin with an e-mail', null);
          continue;
        }
        if (opts.dryRun) {
          row('FIRST_NOTICE_PENDING', `${recipients.length} recipient(s)`, purgeOn);
          continue;
        }
        await this.db.transaction(async (tx) => {
          const [started] = await tx
            .update(tenants)
            .set({ trialPurgeOn: purgeOn, trialPurgeBasis: t.trialEndsAt, trialWarnedAt: null, trialFinalWarnedAt: null })
            .where(and(eq(tenants.id, t.id), sql`${tenants.trialPurgeOn} is null`))
            .returning({ id: tenants.id });
          if (started) await tx.insert(trialNotices).values(recipients.map((r) => ({ tenantId: t.id, kind: 'FIRST', recipient: r, nextAttemptAt: now }))).onConflictDoNothing();
        });
        // Another worker may have begun it a moment earlier: its date stands.
        const fresh = await this.db.query.tenants.findFirst({ where: eq(tenants.id, t.id) });
        if (!fresh) continue;
        Object.assign(t, fresh);
      }

      if (!opts.dryRun) {
        warned += await this.deliverDue(t, now);
        const fresh = await this.db.query.tenants.findFirst({ where: eq(tenants.id, t.id) });
        if (!fresh) continue;
        Object.assign(t, fresh);
      }

      const first = await this.noticeState(t.id, 'FIRST');
      if (!t.trialWarnedAt) {
        row(first === 'FAILED' ? 'FIRST_NOTICE_FAILED' : 'FIRST_NOTICE_PENDING');
        continue;
      }
      if (!t.trialFinalWarnedAt) {
        if (now.getTime() < t.trialPurgeOn!.getTime() - 7 * DAY) {
          row('WAITING_FOR_FINAL');
          continue;
        }
        if (!opts.dryRun) {
          const recipients = await this.recipients(t.id);
          if (recipients.length === 0) {
            row('NO_RECIPIENT', 'nobody to send the last notice to');
            continue;
          }
          await this.db.insert(trialNotices).values(recipients.map((r) => ({ tenantId: t.id, kind: 'FINAL', recipient: r, nextAttemptAt: now }))).onConflictDoNothing();
          warned += await this.deliverDue(t, now);
          const fresh = await this.db.query.tenants.findFirst({ where: eq(tenants.id, t.id) });
          if (fresh) Object.assign(t, fresh);
        }
        if (!t.trialFinalWarnedAt) {
          row((await this.noticeState(t.id, 'FINAL')) === 'FAILED' ? 'FINAL_NOTICE_FAILED' : 'FINAL_NOTICE_PENDING');
          continue;
        }
      }
      if (now < t.trialPurgeOn!) {
        row('WAITING');
        continue;
      }
      if (opts.dryRun) {
        row('WOULD_DELETE');
        continue;
      }
      const gone = await this.deleteIfStillDue(t.id, now);
      row(gone ? 'DELETED' : 'KEPT', gone ? undefined : 'changed since the notices (payment, extension or status)');
      if (gone) deletedIds.push(t.id);
    }
    return { warned, deleted: deletedIds.length, deletedIds, report };
  }

  /** Owners and admins who run the center now, with an address to write to. */
  private async recipients(tenantId: string): Promise<string[]> {
    const rows = await this.db
      .select({ email: users.email })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN'])));
    return [...new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))];
  }

  private async noticeState(tenantId: string, kind: NoticeKind): Promise<'NONE' | 'PENDING' | 'FAILED' | 'ACCEPTED'> {
    const rows = await this.db.select({ status: trialNotices.status }).from(trialNotices).where(and(eq(trialNotices.tenantId, tenantId), eq(trialNotices.kind, kind)));
    if (rows.length === 0) return 'NONE';
    if (rows.some((r) => r.status === 'FAILED')) return 'FAILED';
    return rows.every((r) => r.status === 'ACCEPTED') ? 'ACCEPTED' : 'PENDING';
  }

  /**
   * Sends this center's notices that are due. Each is claimed first (one
   * worker sends it); a failure is retried later, five times in all. When
   * every notice of a kind is accepted, the center records it.
   */
  private async deliverDue(t: Tenant, now: Date): Promise<number> {
    let accepted = 0;
    const due = await this.db
      .select()
      .from(trialNotices)
      .where(and(
        eq(trialNotices.tenantId, t.id),
        lte(trialNotices.nextAttemptAt, now),
        or(eq(trialNotices.status, 'PENDING'), and(eq(trialNotices.status, 'SENDING'), lt(trialNotices.lockedUntil, now))),
      ));
    for (const n of due) {
      const [claimed] = await this.db
        .update(trialNotices)
        .set({ status: 'SENDING', lockedUntil: new Date(now.getTime() + LOCK_MS), attempts: sql`${trialNotices.attempts} + 1` })
        .where(and(eq(trialNotices.id, n.id), or(eq(trialNotices.status, 'PENDING'), and(eq(trialNotices.status, 'SENDING'), lt(trialNotices.lockedUntil, now)))))
        .returning();
      if (!claimed) continue; // another worker has it
      // The date the mail names is the date the system acts on: a last
      // notice that leaves less than 7 days moves the date first.
      // Read from the row, not the scan: another worker may have moved it.
      const later = new Date(now.getTime() + 7 * DAY);
      const [cur] = n.kind === 'FINAL'
        ? await this.db.update(tenants).set({ trialPurgeOn: sql`greatest(${tenants.trialPurgeOn}, ${later.toISOString()}::timestamp)` }).where(eq(tenants.id, t.id)).returning({ purgeOn: tenants.trialPurgeOn })
        : await this.db.select({ purgeOn: tenants.trialPurgeOn }).from(tenants).where(eq(tenants.id, t.id));
      if (!cur?.purgeOn) continue; // the cycle was cancelled meanwhile
      const purgeOn = cur.purgeOn;
      t.trialPurgeOn = purgeOn;
      const { subject, body } = this.message(t.name, n.kind as NoticeKind, purgeOn);
      const result = await this.email.deliver(n.recipient, subject, body, `trial-notice-${n.id}`);
      if (result.accepted) {
        accepted++;
        await this.db.update(trialNotices).set({ status: 'ACCEPTED', acceptedAt: now, providerMessageId: result.providerMessageId ?? null, lockedUntil: null, lastError: null }).where(eq(trialNotices.id, n.id));
      } else {
        const last = claimed.attempts >= MAX_ATTEMPTS;
        await this.db
          .update(trialNotices)
          .set({ status: last ? 'FAILED' : 'PENDING', lastError: result.error ?? 'not accepted', lockedUntil: null, nextAttemptAt: new Date(now.getTime() + 10 * 60_000 * 2 ** (claimed.attempts - 1)) })
          .where(eq(trialNotices.id, n.id));
        this.logger.warn(`Trial notice ${n.kind} for center ${t.id} not accepted (attempt ${claimed.attempts}): ${result.error}`);
      }
    }
    // A kind counts as told once every recipient's copy was accepted.
    for (const kind of ['FIRST', 'FINAL'] as const) {
      if ((await this.noticeState(t.id, kind)) !== 'ACCEPTED') continue;
      const [{ at }] = await this.db.select({ at: sql<Date>`max(${trialNotices.acceptedAt})` }).from(trialNotices).where(and(eq(trialNotices.tenantId, t.id), eq(trialNotices.kind, kind)));
      const at2 = at ? new Date(at) : now;
      if (kind === 'FIRST') await this.db.update(tenants).set({ trialWarnedAt: at2 }).where(and(eq(tenants.id, t.id), sql`${tenants.trialWarnedAt} is null`));
      else await this.db.update(tenants).set({ trialFinalWarnedAt: at2 }).where(and(eq(tenants.id, t.id), sql`${tenants.trialFinalWarnedAt} is null`));
    }
    return accepted;
  }

  /** Under the center's row lock, everything checked again; then delete. */
  private async deleteIfStillDue(tenantId: string, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update');
      if (!t) return false; // another worker did it
      const [paid] = await tx.select({ id: platformSubscriptions.id }).from(platformSubscriptions)
        .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.status, 'PAID'))).limit(1);
      const due = trialRules().purge
        && t.status === 'TRIAL'
        && !paid
        && !!t.trialEndsAt && !!t.trialPurgeBasis && t.trialEndsAt.getTime() === t.trialPurgeBasis.getTime()
        && !!t.trialPurgeOn && t.trialPurgeOn <= now
        && !!t.trialWarnedAt && !!t.trialFinalWarnedAt
        && now.getTime() - t.trialFinalWarnedAt.getTime() >= 6 * DAY;
      if (!due) return false;
      await this.claims.noteBeforeDelete(tx, tenantId);
      await tx.delete(tenants).where(eq(tenants.id, tenantId));
      // In the same transaction: the record of the deletion exists exactly
      // when the deletion does (a rollback leaves neither).
      await this.audit.record(tx, { tenantId: null, userId: null, action: 'trial_purge', entityType: 'tenant', entityId: tenantId, meta: { name: t.name, subdomain: t.subdomain, trialEndsAt: t.trialEndsAt, purgeOn: t.trialPurgeOn } });
      return true;
    });
  }

  private async resetCycle(tenantId: string) {
    await this.db.transaction(async (tx) => {
      await tx.delete(trialNotices).where(eq(trialNotices.tenantId, tenantId));
      await tx.update(tenants).set({ trialPurgeOn: null, trialPurgeBasis: null, trialWarnedAt: null, trialFinalWarnedAt: null }).where(eq(tenants.id, tenantId));
    });
  }

  private message(name: string, kind: NoticeKind, purgeOn: Date) {
    const date = purgeOn.toISOString().slice(0, 10);
    const subject = kind === 'FINAL' ? `TalimCRM: "${name}" ma'lumotlari ${date} kuni o'chiriladi` : `TalimCRM: "${name}" sinov muddati tugagan`;
    const body = [
      'Assalomu alaykum!',
      '',
      `"${name}" markazining bepul sinov muddati tugagan va tarif faollashtirilmagan.`,
      `${date} kuni markaz va undagi barcha ma'lumotlar (o'quvchilar, guruhlar, to'lovlar) butunlay o'chiriladi.`,
      '',
      "Saqlab qolish uchun tizimga kirib tarifni faollashtiring. Ma'lumotlarni yuklab olish: Sozlamalar -> Ma'lumotlarni eksport qilish.",
      '',
      'TalimCRM',
    ].join('\n');
    return { subject, body };
  }
}
