import { BadRequestException, ConflictException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { platformSubscriptions, tenants } from '../db/schema';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';

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

// ---- Which month a payment is for (one rule for card, Click, Payme) ----

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A real month label: "YYYY-MM" with a month 01-12 (00 and 13 are not). */
export function isMonthLabel(v: unknown): v is string {
  return typeof v === 'string' && MONTH_RE.test(v);
}

/** The month label of an instant, in the center's time zone. */
export function monthLabelOf(d: Date, tz: string): string {
  const p = zonedParts(d, isValidTimeZone(tz) ? tz : DEFAULT_TIMEZONE);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** The label after this one ("2026-12" -> "2027-01"). */
export function nextMonthLabel(label: string): string {
  const [y, m] = label.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** Months between two labels (b - a). */
export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

/**
 * The month a new payment pays for. The label is where the paid time
 * continues: the month the paid time runs out in when paying early, or
 * this month (center time) when it has run out or never began - skipping
 * any month already paid (a manual payment may have used it). The browser
 * never chooses it; what the payment buys is decided by applyPayment
 * (from where the paid time ends, or now) whatever the label.
 */
export function paymentMonth(paidUntil: Date | null, now: Date, tz: string, paidLabels: Set<string>): string {
  let label = monthLabelOf(paidUntil && paidUntil > now ? paidUntil : now, tz);
  while (paidLabels.has(label)) label = nextMonthLabel(label);
  return label;
}

/** The month a new payment of this center is for (reads its paid time and paid months). */
export async function nextPaymentMonth(db: Pick<Database, 'select'>, tenantId: string, now = new Date()): Promise<string> {
  const [t] = await db.select({ paidUntil: tenants.paidUntil, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const paid = await db
    .select({ forMonth: platformSubscriptions.forMonth })
    .from(platformSubscriptions)
    .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.status, 'PAID')));
  return paymentMonth(t?.paidUntil ?? null, now, t?.timezone ?? DEFAULT_TIMEZONE, new Set(paid.map((p) => p.forMonth)));
}

/**
 * A month the platform admin may record a payment for by hand: a real
 * month, not more than two years back nor one year ahead.
 */
export function assertRecordableMonth(label: unknown, now = new Date(), tz = DEFAULT_TIMEZONE): string {
  if (!isMonthLabel(label)) throw new BadRequestException("Oy YYYY-MM ko'rinishida bo'lishi kerak (01-12)");
  const d = monthsBetween(monthLabelOf(now, tz), label);
  if (d < -24 || d > 12) throw new BadRequestException("Bu oy uchun to'lov yozib bo'lmaydi (2 yil oldin - 1 yil keyin oralig'ida)");
  return label;
}

// A Payme transaction not performed within 12 hours is cancelled by Payme.
export const PROVIDER_TIMEOUT_MS = 12 * 3_600_000;

/**
 * The month's invoice, ready to be paid (by a provider link, a card receipt
 * or by hand). Every payment path goes through here, in one lock order:
 * the center's payment lock, then the invoice row, then (in applyPayment)
 * the center row.
 *
 * - A paid month is never paid again (409 ALREADY_PAID).
 * - A provider transaction under way is never taken over (409
 *   PAYMENT_IN_PROGRESS); one Payme has timed out is closed as cancelled
 *   (reason 4) and kept, with its transaction id, for Payme to ask about.
 * - A cancelled invoice stays as history; a new one is made.
 * - An invoice nobody is paying yet (CREATED) is reused.
 */
export async function openMonthInvoice(
  tx: Tx,
  tenantId: string,
  forMonth: string,
  plan: string,
  amount: number,
  provider: 'CLICK' | 'PAYME' | null,
  now = new Date(),
) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`platform-pay:${tenantId}`}))`);
  const [live] = await tx
    .select()
    .from(platformSubscriptions)
    .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.forMonth, forMonth), sql`${platformSubscriptions.status} <> 'CANCELLED'`))
    .for('update');
  if (live?.status === 'PAID') {
    throw new ConflictException({ code: 'ALREADY_PAID', message: "Bu oy uchun to'lov allaqachon qilingan" });
  }
  if (live?.status === 'PENDING') {
    const started = live.providerCreatedAt ?? live.createdAt;
    if (now.getTime() - started.getTime() < PROVIDER_TIMEOUT_MS) {
      throw new ConflictException({ code: 'PAYMENT_IN_PROGRESS', message: "Bu oy uchun to'lov hozir Click/Payme orqali amalga oshirilmoqda. Birozdan so'ng urinib ko'ring." });
    }
    await reversePayment(tx, live.id, now, 4);
  }
  const fresh = { plan, amount, provider, status: 'CREATED' as const, providerTxId: null, providerCreatedAt: null, cancelledAt: null, cancelReason: null };
  const [invoice] =
    live?.status === 'CREATED'
      ? await tx.update(platformSubscriptions).set(fresh).where(eq(platformSubscriptions.id, live.id)).returning()
      : await tx.insert(platformSubscriptions).values({ tenantId, forMonth, ...fresh }).returning();
  return invoice;
}

/**
 * A provider callback's invoice, locked in the order every payment path
 * uses (the center's payment lock, then the invoice row): what the
 * callback checks (amount, state, transaction id) is what it writes on.
 * Read once without a lock only to learn the center.
 */
export async function lockInvoiceForCallback(tx: Tx, subscriptionId: string) {
  const [peek] = await tx.select({ tenantId: platformSubscriptions.tenantId }).from(platformSubscriptions).where(eq(platformSubscriptions.id, subscriptionId));
  if (!peek) return undefined;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`platform-pay:${peek.tenantId}`}))`);
  const [sub] = await tx.select().from(platformSubscriptions).where(eq(platformSubscriptions.id, subscriptionId)).for('update');
  return sub;
}

/** Another invoice already carries this provider's transaction id. */
export async function providerTxTaken(tx: Tx, provider: 'CLICK' | 'PAYME', providerTxId: string, subscriptionId: string) {
  const [other] = await tx
    .select({ id: platformSubscriptions.id })
    .from(platformSubscriptions)
    .where(and(eq(platformSubscriptions.provider, provider), eq(platformSubscriptions.providerTxId, providerTxId), sql`${platformSubscriptions.id} <> ${subscriptionId}`))
    .limit(1);
  return !!other;
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
export async function applyPayment(tx: Tx, subscriptionId: string, now = new Date(), opts: { providerTxId?: string; provider?: 'CLICK' | 'PAYME' } = {}) {
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
    .set({ status: 'PAID', paidAt: now, periodStart: start, periodEnd: end, ...(opts.providerTxId ? { providerTxId: opts.providerTxId } : {}), ...(opts.provider ? { provider: opts.provider } : {}) })
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
