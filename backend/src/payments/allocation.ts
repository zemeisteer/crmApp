import { and, asc, eq, sql } from 'drizzle-orm';
import { Database } from '../db/db.module';
import { invoices, paymentAllocations } from '../db/schema';

export type LedgerTx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Invoice = typeof invoices.$inferSelect;

// Everything that changes what a student owes (a payment taken by staff, a
// gateway payment, a new invoice picking up earlier payments) runs in a
// transaction that holds this lock, so two of them never work from the same
// stale balance. Released at commit / rollback.
export async function lockStudentLedger(tx: LedgerTx, studentId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ledger:${studentId}`}, 0))`);
}

// Oldest due first; id breaks ties so the order never depends on the plan.
const byDue = (a: Invoice, b: Invoice) =>
  a.dueDate.getTime() - b.dueDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1);

/** One invoice of this student, row-locked. */
export async function lockInvoice(tx: LedgerTx, tenantId: string, studentId: string, invoiceId: string) {
  const [inv] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId), eq(invoices.studentId, studentId)))
    .for('update');
  return inv as Invoice | undefined;
}

/**
 * The student's invoices of a month that still have something to pay,
 * row-locked, in the order money is applied to them: oldest due date first.
 * A student in several groups has one invoice per group and month; a payment
 * that names no invoice fills them in this order.
 */
export async function lockOpenInvoices(tx: LedgerTx, tenantId: string, studentId: string, forMonth: string) {
  const rows = await tx
    .select()
    .from(invoices)
    .where(and(
      eq(invoices.tenantId, tenantId),
      eq(invoices.studentId, studentId),
      eq(invoices.forMonth, forMonth),
      sql`${invoices.status} <> 'CANCELLED'`,
      sql`${invoices.remainingAmount} > 0`,
    ))
    .orderBy(asc(invoices.id))
    .for('update');
  return (rows as Invoice[]).sort(byDue);
}

/**
 * Applies a payment's money, then its discount, to the given (locked)
 * invoices in order. Returns what was left over: money that no invoice
 * needed stays on the payment as an unallocated advance.
 */
export async function allocateToInvoices(
  tx: LedgerTx,
  p: { tenantId: string; paymentId: string; amount: number; discount?: number },
  targets: Invoice[],
) {
  let cash = p.amount;
  let waive = p.discount ?? 0;
  const touched: string[] = [];
  for (const inv of targets) {
    if (cash <= 0 && waive <= 0) break;
    if (inv.status === 'CANCELLED' || inv.remainingAmount <= 0) continue;
    const paid = Math.min(cash, inv.remainingAmount);
    // A discount given with the payment closes that part of the invoice
    // too; otherwise the waived sum would stay on it as debt.
    const waived = Math.min(waive, inv.remainingAmount - paid);
    if (paid === 0 && waived === 0) continue;
    cash -= paid;
    waive -= waived;
    await tx.insert(paymentAllocations).values({ tenantId: p.tenantId, paymentId: p.paymentId, invoiceId: inv.id, amount: paid });
    const remaining = inv.remainingAmount - paid - waived;
    await tx
      .update(invoices)
      .set({
        amountPaid: inv.amountPaid + paid,
        remainingAmount: remaining,
        status: remaining === 0 ? 'PAID' : 'PARTIALLY_PAID',
        paidAt: remaining === 0 ? new Date() : inv.paidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id));
    touched.push(inv.id);
  }
  return { unallocated: cash, unusedDiscount: waive, invoiceIds: touched };
}
