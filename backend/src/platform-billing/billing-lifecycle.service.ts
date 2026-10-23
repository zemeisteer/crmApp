import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { billingRules } from './billing-period';

const DAY = 86_400_000;

export interface RenewalReportRow {
  tenantId: string;
  name: string;
  subdomain: string;
  paidUntil: Date;
  from: 'ACTIVE' | 'PAST_DUE';
  to: 'PAST_DUE' | 'SUSPENDED';
}

/**
 * Centers whose paid time ran out (tenants.paid_until): PAST_DUE for
 * BILLING_GRACE_DAYS - still working, with a notice - then SUSPENDED for
 * NON_PAYMENT (reads only; paying is open and lifts it, billing-period.ts).
 * Only with BILLING_ENFORCE on; run(now, ids, { dryRun: true }) says what it
 * would do and writes nothing (GET /api/platform/billing/preview). Centers
 * with no paid time (never paid through billing) are never touched. Each
 * change re-reads the center under its row lock: a payment that lands at the
 * same moment wins.
 */
@Injectable()
export class BillingLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('BillingLifecycle');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  onModuleInit() {
    const configured = process.env.BILLING_SCAN_MS;
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.NODE_ENV !== 'production' && !configured) return;
    const ms = Number(configured ?? 3_600_000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      this.run()
        .then((r) => r.changed && this.logger.log(`Renewal pass: ${r.changed} center(s) changed`))
        .catch((err: Error) => this.logger.warn(`Renewal pass failed: ${err.message}`))
        .finally(() => (this.running = false));
    }, ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now: Date = new Date(), onlyTenants?: string[], opts: { dryRun?: boolean } = {}) {
    const rules = billingRules();
    const report: RenewalReportRow[] = [];
    let changed = 0;
    const rows = await this.db
      .select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain, status: tenants.status, paidUntil: tenants.paidUntil })
      .from(tenants)
      .where(and(isNotNull(tenants.paidUntil), inArray(tenants.status, ['ACTIVE', 'PAST_DUE']), onlyTenants ? inArray(tenants.id, onlyTenants) : undefined));

    for (const t of rows) {
      const to = this.target(t.paidUntil!, now, rules.graceDays);
      if (!to || to === t.status) continue;
      report.push({ tenantId: t.id, name: t.name, subdomain: t.subdomain, paidUntil: t.paidUntil!, from: t.status as 'ACTIVE' | 'PAST_DUE', to });
      if (opts.dryRun || !rules.enforce) continue;
      const done = await this.db.transaction(async (tx) => {
        const [cur] = await tx.select().from(tenants).where(eq(tenants.id, t.id)).for('update');
        // Paid, suspended by the admin, or moved on since the scan: leave it.
        if (!cur?.paidUntil || !['ACTIVE', 'PAST_DUE'].includes(cur.status)) return false;
        const target = this.target(cur.paidUntil, now, rules.graceDays);
        if (!target || target === cur.status) return false;
        await tx
          .update(tenants)
          .set(target === 'SUSPENDED' ? { status: 'SUSPENDED', suspendedReason: 'NON_PAYMENT', updatedAt: new Date() } : { status: 'PAST_DUE', updatedAt: new Date() })
          .where(eq(tenants.id, cur.id));
        return target;
      });
      if (!done) continue;
      changed++;
      this.audit.log({ tenantId: t.id, userId: null, action: 'update', entityType: 'platform_subscription', entityId: t.id, meta: { renewal: true, from: t.status, to: done, paidUntil: t.paidUntil } });
      await this.notify(t.id, t.name, done, t.paidUntil!, rules.graceDays);
    }
    return { changed, report, enforce: rules.enforce };
  }

  private target(paidUntil: Date, now: Date, graceDays: number): 'PAST_DUE' | 'SUSPENDED' | null {
    if (now <= paidUntil) return null;
    return now.getTime() > paidUntil.getTime() + graceDays * DAY ? 'SUSPENDED' : 'PAST_DUE';
  }

  // The owners and admins are told; a mail that does not go is logged, the
  // banner in the app says the same.
  private async notify(tenantId: string, name: string, to: 'PAST_DUE' | 'SUSPENDED', paidUntil: Date, graceDays: number) {
    const rows = await this.db
      .select({ email: users.email })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN'])));
    const until = new Date(paidUntil.getTime() + graceDays * DAY).toISOString().slice(0, 10);
    const subject = to === 'PAST_DUE' ? `TalimCRM: "${name}" to'lov muddati o'tdi` : `TalimCRM: "${name}" to'lov qilinmagani uchun to'xtatildi`;
    const body = to === 'PAST_DUE'
      ? `"${name}" markazining to'langan muddati ${paidUntil.toISOString().slice(0, 10)} kuni tugadi.\nMarkaz ${until} gacha odatdagidek ishlaydi. Shu kungacha tarifni to'lang, aks holda markaz faqat ko'rish rejimiga o'tadi.\n\nTalimCRM`
      : `"${name}" markazi to'lov qilinmagani uchun faqat ko'rish rejimiga o'tkazildi. Ma'lumotlaringiz saqlanadi. To'lov qilingach markaz darhol qayta ishlaydi.\n\nTalimCRM`;
    for (const r of rows) {
      const res = await this.email.deliver(r.email, subject, body, `renewal-${tenantId}-${to}-${paidUntil.toISOString().slice(0, 10)}`);
      if (!res.accepted) this.logger.warn(`Renewal notice for center ${tenantId} not accepted: ${res.error}`);
    }
  }
}
