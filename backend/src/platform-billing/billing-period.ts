import { eq, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { platformSubscriptions, tenants } from '../db/schema';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'on', 'yes'].includes(v);
};
const count = (name: string, fallback: number) => {
  const v = Number(process.env[name]?.trim() || fallback);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
};

/**
 * The renewal rules, read at call time:
 * - BILLING_ENFORCE (off by default): when the paid period runs out the
 *   center becomes PAST_DUE, and after the grace days SUSPENDED for
 *   non-payment. Off, nothing changes (the preview still says what would).
 * - BILLING_GRACE_DAYS (7): PAST_DUE centers keep working this long.
 */
export function billingRules() {
  return { enforce: flag('BILLING_ENFORCE', false), graceDays: count('BILLING_GRACE_DAYS', 7) };
}

/** The same day of the next month (the 31st becomes the month's last day). */
export function addMonth(d: Date): Date {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  const last = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(d.getUTCDate(), last));
  return next;
}

/**
 * Marks an invoice paid and adds its month to the center's paid time, under
 * the invoice's and the center's row locks: a retried callback finds it paid
 * and adds nothing. The month starts where the paid time ends (paying early
 * loses nothing) or now. A center suspended for non-payment comes back; one
 * the platform admin suspended stays suspended (the payment still counts).
 */
export async function applyPayment(tx: Tx, subscriptionId: string, now = new Date(), opts: { providerTxId?: string } = {}) {
  const [sub] = await tx.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, subscriptionId)).for('update');
  if (!sub) return { outcome: 'NOT_FOUND' as const };
  if (sub.status === 'PAID') return { outcome: 'ALREADY_PAID' as const, sub };
  if (sub.status === 'CANCELLED') return { outcome: 'CANCELLED' as const, sub };
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, sub.tenantId)).for('update');
  if (!t) return { outcome: 'NOT_FOUND' as const };
  const start = t.paidUntil && t.paidUntil > now ? t.paidUntil : now;
  const end = addMonth(start);
  const [paid] = await tx
    .update(platformSubscriptions)
    .set({ status: 'PAID', paidAt: now, periodStart: start, periodEnd: end, ...(opts.providerTxId ? { providerTxId: opts.providerTxId } : {}) })
    .where(eq(platformSubscriptions.id, sub.id))
    .returning();
  const adminSuspended = t.status === 'SUSPENDED' && t.suspendedReason !== 'NON_PAYMENT';
  await tx
    .update(tenants)
    .set({ paidUntil: end, plan: sub.plan, ...(adminSuspended ? {} : { status: 'ACTIVE' as const, suspendedReason: null }), updatedAt: new Date() })
    .where(eq(tenants.id, t.id));
  return { outcome: 'PAID' as const, sub: paid, tenantStatus: adminSuspended ? t.status : 'ACTIVE' };
}

/**
 * A payment taken back (the provider cancelled it after it was made): the
 * invoice is cancelled and its month comes off the center's paid time. What
 * that means for the center (past due, suspended) is the renewal pass's call.
 */
export async function reversePayment(tx: Tx, subscriptionId: string, now = new Date(), reason?: number) {
  const [sub] = await tx.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, subscriptionId)).for('update');
  if (!sub) return { outcome: 'NOT_FOUND' as const };
  if (sub.status === 'CANCELLED') return { outcome: 'ALREADY_CANCELLED' as const, sub };
  const wasPaid = sub.status === 'PAID';
  const [cancelled] = await tx
    .update(platformSubscriptions)
    .set({ status: 'CANCELLED', cancelledAt: now, cancelReason: reason ?? null })
    .where(eq(platformSubscriptions.id, sub.id))
    .returning();
  if (wasPaid && sub.periodStart && sub.periodEnd) {
    const months = sub.periodEnd.getTime() - sub.periodStart.getTime();
    await tx
      .update(tenants)
      .set({ paidUntil: sql`${tenants.paidUntil} - (${months} * interval '1 millisecond')`, updatedAt: new Date() })
      .where(eq(tenants.id, sub.tenantId));
  }
  return { outcome: wasPaid ? ('REVERSED' as const) : ('CANCELLED' as const), sub: cancelled };
}
