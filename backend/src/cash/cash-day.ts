/**
 * One center's day at the desk, worked out from the records:
 * money in = PAID payments whose paidAt falls in the center's calendar day;
 * money out = expenses dated that day (payroll payouts are expenses too).
 * Cash in the drawer should be cash in minus cash out; the other methods
 * (Click, Payme, bank transfer) never pass through the drawer.
 */
export type Method = 'CASH' | 'CLICK' | 'PAYME' | 'BANK_TRANSFER';
export const METHODS: Method[] = ['CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER'];

export interface DayPayment {
  id: string;
  amount: number;
  method: string;
  paidAt: Date;
  createdAt: Date;
  studentName: string;
  recordedById: string | null;
  recordedByName: string | null;
}
export interface DayExpense {
  id: string;
  title: string;
  amount: number;
  paymentMethod: string;
  category: string;
  createdAt: Date;
}

export interface CashDay {
  date: string;
  timezone: string;
  in: Record<Method, { amount: number; count: number }>;
  out: Record<Method, { amount: number; count: number }>;
  totalIn: number;
  totalOut: number;
  expectedCash: number; // cash in - cash out
  byCashier: Array<{ userId: string | null; name: string | null; cash: number; other: number; count: number }>;
  payments: Array<DayPayment & { afterClosing: boolean }>;
  expenses: Array<DayExpense & { afterClosing: boolean }>;
}

const empty = () => Object.fromEntries(METHODS.map((m) => [m, { amount: 0, count: 0 }])) as Record<Method, { amount: number; count: number }>;
const asMethod = (m: string): Method => (METHODS.includes(m as Method) ? (m as Method) : 'CASH');

export function cashDay(date: string, timezone: string, payments: DayPayment[], expenses: DayExpense[], closedAt: Date | null): CashDay {
  const inn = empty();
  const out = empty();
  const cashiers = new Map<string, { userId: string | null; name: string | null; cash: number; other: number; count: number }>();
  for (const p of payments) {
    const m = asMethod(p.method);
    inn[m].amount += p.amount;
    inn[m].count += 1;
    const k = p.recordedById ?? '';
    const c = cashiers.get(k) ?? { userId: p.recordedById, name: p.recordedByName, cash: 0, other: 0, count: 0 };
    if (m === 'CASH') c.cash += p.amount;
    else c.other += p.amount;
    c.count += 1;
    cashiers.set(k, c);
  }
  for (const e of expenses) {
    const m = asMethod(e.paymentMethod);
    out[m].amount += e.amount;
    out[m].count += 1;
  }
  const after = (d: Date) => !!closedAt && d.getTime() > closedAt.getTime();
  const sum = (r: Record<Method, { amount: number }>) => METHODS.reduce((s, m) => s + r[m].amount, 0);
  return {
    date,
    timezone,
    in: inn,
    out,
    totalIn: sum(inn),
    totalOut: sum(out),
    expectedCash: inn.CASH.amount - out.CASH.amount,
    // Most taken first; equal amounts by name, so the order is stable.
    byCashier: [...cashiers.values()].sort((a, b) => b.cash + b.other - (a.cash + a.other) || (a.name ?? '\uffff').localeCompare(b.name ?? '\uffff')),
    payments: [...payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime()).map((p) => ({ ...p, afterClosing: after(p.createdAt) })),
    expenses: [...expenses].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((e) => ({ ...e, afterClosing: after(e.createdAt) })),
  };
}
