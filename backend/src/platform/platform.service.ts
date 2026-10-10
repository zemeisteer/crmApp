import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { plans, platformSubscriptions, students, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ListSubscriptionsDto, RecordPaymentDto, UpdateSubscriptionDto } from './dto/platform.dto';

const DAY_MS = 86_400_000;
const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] as const;
type TenantStatus = (typeof STATUSES)[number];

/** "2026-10" for a date, in UTC (platform months, as platform_subscriptions.for_month). */
export function monthOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** The months ending with `month`, oldest first. */
export function lastMonths(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => monthOf(new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1))));
}

/** The first moment after a paid month: a month paid for runs to here. */
export function monthEnd(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1));
}

/**
 * How long a center may still work on what it has: a trial runs to its end
 * date, a paid tariff to the end of the last month paid for; a free tariff
 * has nothing to run out. Negative: overdue by that many days.
 */
export function daysLeft(now: Date, t: { status: string; trialEndsAt: Date | null }, price: number, lastPaidMonth: string | null): number | null {
  if (t.status === 'TRIAL') return t.trialEndsAt ? Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY_MS) : null;
  if (price <= 0) return null;
  if (!lastPaidMonth) return 0;
  return Math.ceil((monthEnd(lastPaidMonth).getTime() - now.getTime()) / DAY_MS);
}

@Injectable()
export class PlatformService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private async planMap() {
    const all = await this.db.query.plans.findMany({ orderBy: (p, { asc }) => asc(p.price) });
    return { all, byKey: new Map(all.map((p) => [p.key, p])) };
  }

  /** The last paid month and the total paid, per center. */
  private async paidByTenant(tenantIds?: string[]) {
    if (tenantIds && tenantIds.length === 0) return new Map<string, { lastPaidMonth: string; totalPaid: number }>();
    const rows = await this.db
      .select({
        tenantId: platformSubscriptions.tenantId,
        lastPaidMonth: sql<string>`max(${platformSubscriptions.forMonth})`,
        totalPaid: sql<number>`coalesce(sum(${platformSubscriptions.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.status, 'PAID'), tenantIds ? inArray(platformSubscriptions.tenantId, tenantIds) : undefined))
      .groupBy(platformSubscriptions.tenantId);
    return new Map(rows.map((r) => [r.tenantId, { lastPaidMonth: r.lastPaidMonth, totalPaid: r.totalPaid }]));
  }

  // ---- Dashboard ----

  async dashboard() {
    const now = new Date();
    const month = monthOf(now);
    const months = lastMonths(month, 6);
    const { all: planList, byKey } = await this.planMap();
    const list = await this.db
      .select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain, plan: tenants.plan, status: tenants.status, trialEndsAt: tenants.trialEndsAt, createdAt: tenants.createdAt })
      .from(tenants);
    const paid = await this.paidByTenant();

    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<TenantStatus, number>;
    const centersByPlan = new Map<string, { centers: number; active: number }>();
    const signups = new Map(months.map((m) => [m, 0]));
    let mrr = 0;
    let newThisMonth = 0;
    const trialsEnding: Array<{ id: string; name: string; subdomain: string; daysLeft: number; trialEndsAt: Date }> = [];
    const trialsExpired: typeof trialsEnding = [];
    const unpaid: Array<{ id: string; name: string; subdomain: string; plan: string; price: number; lastPaidMonth: string | null }> = [];

    for (const t of list) {
      byStatus[t.status as TenantStatus] = (byStatus[t.status as TenantStatus] ?? 0) + 1;
      const price = byKey.get(t.plan)?.price ?? 0;
      const row = centersByPlan.get(t.plan) ?? { centers: 0, active: 0 };
      row.centers += 1;
      if (t.status === 'ACTIVE') {
        row.active += 1;
        mrr += price;
      }
      centersByPlan.set(t.plan, row);
      const created = monthOf(t.createdAt);
      if (signups.has(created)) signups.set(created, signups.get(created)! + 1);
      if (created === month) newThisMonth += 1;
      if (t.status === 'TRIAL' && t.trialEndsAt) {
        const left = Math.ceil((t.trialEndsAt.getTime() - now.getTime()) / DAY_MS);
        const entry = { id: t.id, name: t.name, subdomain: t.subdomain, daysLeft: left, trialEndsAt: t.trialEndsAt };
        if (left < 0) trialsExpired.push(entry);
        else if (left <= 7) trialsEnding.push(entry);
      }
      if (price > 0 && (t.status === 'ACTIVE' || t.status === 'PAST_DUE')) {
        const last = paid.get(t.id)?.lastPaidMonth ?? null;
        if (!last || last < month) unpaid.push({ id: t.id, name: t.name, subdomain: t.subdomain, plan: t.plan, price, lastPaidMonth: last });
      }
    }

    const revenueRows = await this.db
      .select({ month: platformSubscriptions.forMonth, amount: sql<number>`coalesce(sum(${platformSubscriptions.amount}), 0)::bigint`.mapWith(Number), count: sql<number>`count(*)::int` })
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.status, 'PAID'), inArray(platformSubscriptions.forMonth, months)))
      .groupBy(platformSubscriptions.forMonth);
    const revenue = new Map(revenueRows.map((r) => [r.month, r]));

    const recent = await this.db
      .select({
        id: platformSubscriptions.id, tenantId: platformSubscriptions.tenantId, name: tenants.name, plan: platformSubscriptions.plan,
        amount: platformSubscriptions.amount, forMonth: platformSubscriptions.forMonth, provider: platformSubscriptions.provider, paidAt: platformSubscriptions.paidAt,
      })
      .from(platformSubscriptions)
      .innerJoin(tenants, eq(tenants.id, platformSubscriptions.tenantId))
      .where(eq(platformSubscriptions.status, 'PAID'))
      .orderBy(desc(platformSubscriptions.paidAt))
      .limit(8);

    const [[studentTotal], [userTotal]] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(students).where(and(isNull(students.deletedAt), eq(students.status, 'ACTIVE'))),
      this.db.select({ n: sql<number>`count(*)::int` }).from(users),
    ]);

    return {
      month,
      centers: { total: list.length, newThisMonth, byStatus },
      students: studentTotal?.n ?? 0,
      users: userTotal?.n ?? 0,
      // What the active centers' tariffs add up to for a month, and what has
      // actually been paid for this one.
      mrr,
      paidThisMonth: revenue.get(month)?.amount ?? 0,
      paymentsThisMonth: revenue.get(month)?.count ?? 0,
      plans: planList.map((p) => ({ key: p.key, name: p.name, price: p.price, active: p.active, centers: centersByPlan.get(p.key)?.centers ?? 0, activeCenters: centersByPlan.get(p.key)?.active ?? 0 })),
      signups: months.map((m) => ({ month: m, count: signups.get(m) ?? 0 })),
      revenue: months.map((m) => ({ month: m, amount: revenue.get(m)?.amount ?? 0 })),
      // Trials with a week or less to go, and trials already over (the
      // center is still marked TRIAL): the newest first.
      trialsEnding: { count: trialsEnding.length, items: trialsEnding.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 8) },
      trialsExpired: { count: trialsExpired.length, items: trialsExpired.sort((a, b) => b.daysLeft - a.daysLeft).slice(0, 8) },
      unpaid: { count: unpaid.length, amount: unpaid.reduce((s, u) => s + u.price, 0), items: unpaid.sort((a, b) => b.price - a.price).slice(0, 8) },
      recentPayments: recent,
    };
  }

  // ---- Subscriptions ----

  async subscriptions(query: ListSubscriptionsDto) {
    const now = new Date();
    const month = monthOf(now);
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, query.pageSize ?? 20));
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(tenants.status, query.status as TenantStatus));
    if (query.plan) conditions.push(eq(tenants.plan, query.plan));
    const search = query.search?.trim();
    if (search) {
      const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(ilike(tenants.name, like), ilike(tenants.subdomain, like))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [[count], rows, { byKey }] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(tenants).where(where),
      this.db
        .select({ id: tenants.id, name: tenants.name, subdomain: tenants.subdomain, plan: tenants.plan, status: tenants.status, trialEndsAt: tenants.trialEndsAt, createdAt: tenants.createdAt })
        .from(tenants)
        .where(where)
        .orderBy(desc(tenants.createdAt), tenants.id)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.planMap(),
    ]);
    const paid = await this.paidByTenant(rows.map((r) => r.id));

    return {
      month,
      page,
      pageSize,
      total: count?.n ?? 0,
      items: rows.map((t) => {
        const plan = byKey.get(t.plan);
        const price = plan?.price ?? 0;
        const p = paid.get(t.id);
        const lastPaidMonth = p?.lastPaidMonth ?? null;
        return {
          ...t,
          planName: plan?.name ?? t.plan,
          price,
          lastPaidMonth,
          totalPaid: p?.totalPaid ?? 0,
          paidThisMonth: price <= 0 ? null : !!lastPaidMonth && lastPaidMonth >= month,
          daysLeft: daysLeft(now, t, price, lastPaidMonth),
        };
      }),
    };
  }

  private async tenant(id: string) {
    const [t] = await this.db.select().from(tenants).where(eq(tenants.id, id));
    if (!t) throw new NotFoundException('Markaz topilmadi');
    return t;
  }

  async payments(tenantId: string) {
    await this.tenant(tenantId);
    return this.db
      .select({
        id: platformSubscriptions.id, plan: platformSubscriptions.plan, amount: platformSubscriptions.amount, forMonth: platformSubscriptions.forMonth,
        status: platformSubscriptions.status, provider: platformSubscriptions.provider, paidAt: platformSubscriptions.paidAt, createdAt: platformSubscriptions.createdAt,
      })
      .from(platformSubscriptions)
      .where(eq(platformSubscriptions.tenantId, tenantId))
      .orderBy(desc(platformSubscriptions.forMonth))
      .limit(36);
  }

  async updateSubscription(actorId: string, tenantId: string, dto: UpdateSubscriptionDto) {
    const before = await this.tenant(tenantId);
    const set: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (dto.plan !== undefined) {
      const [plan] = await this.db.select({ key: plans.key }).from(plans).where(eq(plans.key, dto.plan));
      if (!plan) throw new BadRequestException('Bunday tarif yo\'q');
      set.plan = dto.plan;
    }
    if (dto.status !== undefined) set.status = dto.status as TenantStatus;
    if (dto.trialEndsAt !== undefined) {
      const date = dto.trialEndsAt ? new Date(dto.trialEndsAt) : null;
      if (date && Number.isNaN(date.getTime())) throw new BadRequestException("Sana noto'g'ri");
      set.trialEndsAt = date;
    }
    const [after] = await this.db.update(tenants).set(set).where(eq(tenants.id, tenantId)).returning();
    this.audit.log({
      tenantId, userId: actorId, action: 'update', entityType: 'platform_subscription', entityId: tenantId,
      meta: { from: { plan: before.plan, status: before.status, trialEndsAt: before.trialEndsAt }, to: { plan: after.plan, status: after.status, trialEndsAt: after.trialEndsAt } },
    });
    return { id: after.id, plan: after.plan, status: after.status, trialEndsAt: after.trialEndsAt };
  }

  /**
   * A month paid outside Click/Payme (cash, a bank transfer): recorded as a
   * paid month, and the center becomes active on that tariff, exactly as a
   * provider's payment does.
   */
  async recordPayment(actorId: string, tenantId: string, dto: RecordPaymentDto) {
    const tenant = await this.tenant(tenantId);
    const planKey = dto.plan ?? tenant.plan;
    const [plan] = await this.db.select().from(plans).where(eq(plans.key, planKey));
    if (!plan) throw new BadRequestException('Bunday tarif yo\'q');
    const amount = dto.amount ?? plan.price;
    if (amount <= 0) throw new BadRequestException("Bepul tarif uchun to'lov qayd etilmaydi");

    const row = await this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(platformSubscriptions)
        .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.forMonth, dto.forMonth)))
        .for('update');
      if (existing?.status === 'PAID') throw new ConflictException("Bu oy uchun to'lov allaqachon qayd etilgan");
      const values = { plan: planKey, amount, status: 'PAID' as const, provider: null, providerTxId: null, paidAt: new Date() };
      const [saved] = existing
        ? await tx.update(platformSubscriptions).set(values).where(eq(platformSubscriptions.id, existing.id)).returning()
        : await tx.insert(platformSubscriptions).values({ tenantId, forMonth: dto.forMonth, ...values }).returning();
      await tx.update(tenants).set({ plan: planKey, status: 'ACTIVE', updatedAt: new Date() }).where(eq(tenants.id, tenantId));
      return saved;
    });
    this.audit.log({ tenantId, userId: actorId, action: 'create', entityType: 'platform_payment', entityId: row.id, meta: { forMonth: dto.forMonth, plan: planKey, amount, manual: true } });
    return row;
  }
}
