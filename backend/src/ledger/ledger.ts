// What a student owes for one month. Pure functions over already-loaded
// rows; every screen that shows debt (payments page, finance summary,
// dashboard, director's report, reminders, the student's cabinet) uses
// these, so they cannot disagree.
//
// Sources, in order of trust:
//  1. Invoices of that month. Their amounts were fixed when they were
//     issued, so later price or status changes do not rewrite them. They
//     count whatever the student's status is now.
//  2. For an enrollment with no invoice that month: the enrollment's own
//     dates decide whether the month is owed, and the group's price is the
//     one in force in that month (group_price_history).
//
// Where history was never recorded the rule is "no invented debt": an ended
// enrollment or a paused student without a date, and the month in which a
// student left or paused, are not charged unless an invoice says so.

export interface LedgerEnrollment {
  id: string;
  groupId: string;
  groupName: string;
  status: string; // ACTIVE | PAUSED | COMPLETED | CANCELLED
  joinedMonth: string; // YYYY-MM in the center's time zone
  leftMonth: string | null;
  groupDeletedMonth: string | null;
  /** Prices of the group, oldest first; `from` is the month a price started. */
  prices: Array<{ from: string; price: number }>;
}

export interface LedgerStudent {
  id: string;
  status: string; // ACTIVE | PAUSED | GRADUATED | LEFT
  leftMonth: string | null;
  pausedMonth: string | null;
  deletedMonth: string | null;
  enrollments: LedgerEnrollment[];
}

export interface LedgerInvoice {
  enrollmentId: string | null;
  amount: number;
  amountPaid: number;
  remainingAmount: number;
}

/** A PAID payment of the month; `allocated` is what went to invoices. */
export interface LedgerPayment {
  amount: number;
  discount: number;
  allocated: number | null; // null: not linked to any invoice
}

export interface MonthDue {
  /** Tuition of the month before discounts. */
  expected: number;
  discount: number;
  paid: number;
  debt: number;
  /** Part of `expected` that comes from enrollments, not invoices. */
  estimated: number;
  groups: Array<{ id: string; name: string; monthlyPrice: number }>;
}

export function priceAt(prices: LedgerEnrollment['prices'], month: string): number {
  if (prices.length === 0) return 0;
  let price = prices[0].price; // before the first record: the earliest known price
  for (const p of prices) if (p.from <= month) price = p.price;
  return price;
}

/** Was this enrollment being studied (and so owed) for the whole of `month`? */
export function enrollmentOwes(s: LedgerStudent, e: LedgerEnrollment, month: string): boolean {
  if (e.joinedMonth > month) return false;
  if (e.groupDeletedMonth && month >= e.groupDeletedMonth) return false;
  if (s.deletedMonth && month >= s.deletedMonth) return false;
  if (s.status === 'LEFT' || s.status === 'GRADUATED') {
    if (!s.leftMonth || month >= s.leftMonth) return false;
  } else if (s.status === 'PAUSED') {
    if (!s.pausedMonth || month >= s.pausedMonth) return false;
  }
  if (e.status === 'ACTIVE') return true;
  if (e.status === 'PAUSED') return false; // no date is kept for it
  return Boolean(e.leftMonth && month < e.leftMonth);
}

export function monthDue(s: LedgerStudent, month: string, invoices: LedgerInvoice[], payments: LedgerPayment[]): MonthDue {
  const groups: MonthDue['groups'] = [];
  const byEnrollment = new Map(s.enrollments.map((e) => [e.id, e]));

  let invoiced = 0;
  let invoiceDebt = 0;
  let waived = 0;
  const covered = new Set<string>();
  let general = false; // an invoice not tied to one group stands for the whole month
  for (const inv of invoices) {
    invoiced += inv.amount;
    invoiceDebt += inv.remainingAmount;
    waived += Math.max(0, inv.amount - inv.amountPaid - inv.remainingAmount);
    const e = inv.enrollmentId ? byEnrollment.get(inv.enrollmentId) : undefined;
    if (inv.enrollmentId) covered.add(inv.enrollmentId);
    else general = true;
    if (e && !groups.some((g) => g.id === e.groupId)) groups.push({ id: e.groupId, name: e.groupName, monthlyPrice: inv.amount });
  }

  let estimated = 0;
  if (!general) {
    for (const e of s.enrollments) {
      if (covered.has(e.id) || !enrollmentOwes(s, e, month)) continue;
      const price = priceAt(e.prices, month);
      estimated += price;
      if (!groups.some((g) => g.id === e.groupId)) groups.push({ id: e.groupId, name: e.groupName, monthlyPrice: price });
    }
  }

  // Money and discounts not tied to an invoice (taken before invoices
  // existed, or more than the invoices needed) still count for the month.
  let paid = 0;
  let credit = 0;
  let looseDiscount = 0;
  for (const p of payments) {
    paid += p.amount;
    credit += Math.max(0, p.amount - (p.allocated ?? 0));
    if (p.allocated === null) looseDiscount += p.discount;
  }

  return {
    expected: invoiced + estimated,
    discount: waived + looseDiscount,
    paid,
    debt: Math.max(0, invoiceDebt + estimated - credit - looseDiscount),
    estimated,
    groups,
  };
}

export const monthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
