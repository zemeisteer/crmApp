import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, platformSubscriptions, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { trialRules } from './trial-rules';

const DAY = 86_400_000;

/**
 * Unpaid trials that ended long ago (TRIAL_PURGE on, see trial-rules.ts):
 * the owners and admins get an e-mail 14 days and again 7 days before the
 * center is deleted; then the center and everything in it is deleted. A
 * center that ever paid (a platform subscription payment marked PAID) is never
 * deleted here, nor one whose last notice went out less than 6 days ago.
 * Runs every TRIAL_SCAN_MS (6 h in production; off elsewhere unless set).
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
        .then((r) => (r.warned || r.deleted) && this.logger.log(`Trial notices: ${r.warned}, centers deleted: ${r.deleted}`))
        .catch((err: Error) => this.logger.warn(`Trial pass failed: ${err.message}`))
        .finally(() => (this.running = false));
    }, ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass: notices due, then deletions due. `onlyTenants` limits it (tests). */
  async run(now: Date = new Date(), onlyTenants?: string[]): Promise<{ warned: number; deleted: number; deletedIds: string[] }> {
    const rules = trialRules();
    if (!rules.purge) return { warned: 0, deleted: 0, deletedIds: [] };
    const purgeAfter = rules.purgeDays * DAY;

    const candidates = await this.db
      .select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain, trialEndsAt: tenants.trialEndsAt, warnedAt: tenants.trialWarnedAt, finalAt: tenants.trialFinalWarnedAt })
      .from(tenants)
      .where(
        and(
          eq(tenants.status, 'TRIAL'),
          isNotNull(tenants.trialEndsAt),
          // Two weeks before the deletion date at the latest.
          sql`${tenants.trialEndsAt} <= ${new Date(now.getTime() - purgeAfter + 14 * DAY)}`,
          sql`not exists (select 1 from ${platformSubscriptions} where ${platformSubscriptions.tenantId} = ${tenants.id} and ${platformSubscriptions.status} = 'PAID')`,
          onlyTenants ? inArray(tenants.id, onlyTenants) : undefined,
        ),
      );

    let warned = 0;
    const deletedIds: string[] = [];
    for (const t of candidates) {
      const purgeAt = new Date(new Date(t.trialEndsAt!).getTime() + purgeAfter);
      const daysLeft = Math.ceil((purgeAt.getTime() - now.getTime()) / DAY);
      if (!t.warnedAt) {
        await this.notify(t, purgeAt, false);
        await this.db.update(tenants).set({ trialWarnedAt: now }).where(eq(tenants.id, t.id));
        warned++;
        continue;
      }
      if (!t.finalAt && daysLeft <= 7) {
        await this.notify(t, purgeAt, true);
        await this.db.update(tenants).set({ trialFinalWarnedAt: now }).where(eq(tenants.id, t.id));
        warned++;
        continue;
      }
      if (t.finalAt && now >= purgeAt && now.getTime() - new Date(t.finalAt).getTime() >= 6 * DAY) {
        // Checked again in the delete itself: a payment or plan change since the list was read keeps it.
        const gone = await this.db
          .delete(tenants)
          .where(
            and(
              eq(tenants.id, t.id),
              eq(tenants.status, 'TRIAL'),
              sql`not exists (select 1 from ${platformSubscriptions} where ${platformSubscriptions.tenantId} = ${tenants.id} and ${platformSubscriptions.status} = 'PAID')`,
            ),
          )
          .returning({ id: tenants.id });
        if (gone.length) {
          deletedIds.push(t.id);
          this.audit.log({ tenantId: null, userId: null, action: 'trial_purge', entityType: 'tenant', entityId: t.id, meta: { name: t.name, subdomain: t.subdomain, trialEndsAt: t.trialEndsAt } });
        }
      }
    }
    return { warned, deleted: deletedIds.length, deletedIds };
  }

  private async notify(t: { id: string; name: string }, purgeAt: Date, final: boolean) {
    const people = await this.db
      .select({ email: users.email, fullName: users.fullName })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.tenantId, t.id), eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN'])));
    const date = purgeAt.toISOString().slice(0, 10);
    const subject = final ? `TalimCRM: "${t.name}" ma'lumotlari 7 kundan keyin o'chiriladi` : `TalimCRM: "${t.name}" sinov muddati tugagan`;
    for (const p of people) {
      const body = [
        `Assalomu alaykum, ${p.fullName}!`,
        '',
        `"${t.name}" markazining bepul sinov muddati tugagan va tarif faollashtirilmagan.`,
        `${date} kuni markaz va undagi barcha ma'lumotlar (o'quvchilar, guruhlar, to'lovlar) butunlay o'chiriladi.`,
        '',
        "Saqlab qolish uchun tizimga kirib tarifni faollashtiring. Ma'lumotlarni yuklab olish: Sozlamalar -> Ma'lumotlarni eksport qilish.",
        '',
        'TalimCRM',
      ].join('\n');
      void this.email.send(p.email, subject, body);
    }
  }
}
