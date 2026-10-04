/**
 * Read-only reconciliation of payroll records made before 0035.
 *
 * Before 0035 a month had one salary_payments row per teacher, and every
 * payout overwrote its amount while adding a new SALARY expense (titled
 * "O'qituvchi maoshi: <name> (<YYYY-MM>)"); the older "mark as paid" button
 * wrote the row with no expense at all. Finance totals count money out as
 * all expenses plus the salary rows with no linked expense, so an old row
 * whose expenses also exist is counted twice there.
 *
 * Old rows are matched to unlinked SALARY expenses by that title only - the
 * one link the old code left. A match is a hint for a person to check, never
 * a fact: the report changes nothing.
 */
export type ReconciliationStatus =
  // Old row, no expense with its title: counted once (from the row), but
  // missing from the expense list.
  | 'NO_EXPENSE'
  // Old row and its expenses sum to the same amount: probably the same
  // money, counted twice in finance totals.
  | 'LIKELY_DOUBLE_COUNTED'
  // Old row and its expenses differ: several payouts overwrote the row's
  // amount (it holds the last one), or one side was edited.
  | 'AMOUNT_MISMATCH';

export interface LegacySalaryRow {
  id: string;
  teacherId: string;
  teacherName: string;
  forMonth: string;
  amount: number;
  paidAt: Date;
}

export interface UnlinkedSalaryExpense {
  id: string;
  title: string;
  amount: number;
  date: string;
}

export interface PayrollReconciliationItem {
  salaryPaymentId: string;
  teacherId: string;
  teacherName: string;
  forMonth: string;
  recordedAmount: number;
  paidAt: Date;
  matchedExpenses: UnlinkedSalaryExpense[];
  matchedExpenseTotal: number;
  difference: number; // matchedExpenseTotal - recordedAmount
  status: ReconciliationStatus;
}

export interface PayrollReconciliation {
  forMonth: string | null;
  items: PayrollReconciliationItem[];
  // SALARY expenses that match no salary row: paid outside payroll, so the
  // payroll does not count them as paid.
  expensesWithoutPayroll: UnlinkedSalaryExpense[];
  totals: {
    legacyRows: number;
    likelyDoubleCounted: number; // amount
    mismatched: number; // rows
    withoutExpense: number; // rows
    expensesWithoutPayroll: number; // amount
  };
}

export const salaryExpenseTitle = (teacherName: string, forMonth: string) => `O'qituvchi maoshi: ${teacherName} (${forMonth})`;

export function reconcileLegacyPayroll(
  legacy: LegacySalaryRow[],
  unlinkedExpenses: UnlinkedSalaryExpense[],
  forMonth?: string,
): PayrollReconciliation {
  const used = new Set<string>();
  const items: PayrollReconciliationItem[] = [];
  const sorted = [...legacy].sort((a, b) => a.forMonth.localeCompare(b.forMonth) || a.teacherName.localeCompare(b.teacherName) || a.id.localeCompare(b.id));
  for (const row of sorted) {
    const title = salaryExpenseTitle(row.teacherName, row.forMonth);
    const matched = unlinkedExpenses.filter((e) => !used.has(e.id) && e.title.trim() === title).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const e of matched) used.add(e.id);
    const matchedExpenseTotal = matched.reduce((s, e) => s + e.amount, 0);
    const status: ReconciliationStatus = matched.length === 0 ? 'NO_EXPENSE' : matchedExpenseTotal === row.amount ? 'LIKELY_DOUBLE_COUNTED' : 'AMOUNT_MISMATCH';
    items.push({
      salaryPaymentId: row.id,
      teacherId: row.teacherId,
      teacherName: row.teacherName,
      forMonth: row.forMonth,
      recordedAmount: row.amount,
      paidAt: row.paidAt,
      matchedExpenses: matched,
      matchedExpenseTotal,
      difference: matchedExpenseTotal - row.amount,
      status,
    });
  }
  const expensesWithoutPayroll = unlinkedExpenses
    .filter((e) => !used.has(e.id) && (!forMonth || e.date.startsWith(forMonth)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {
    forMonth: forMonth ?? null,
    items,
    expensesWithoutPayroll,
    totals: {
      legacyRows: items.length,
      likelyDoubleCounted: items.filter((i) => i.status === 'LIKELY_DOUBLE_COUNTED').reduce((s, i) => s + i.recordedAmount, 0),
      mismatched: items.filter((i) => i.status === 'AMOUNT_MISMATCH').length,
      withoutExpense: items.filter((i) => i.status === 'NO_EXPENSE').length,
      expensesWithoutPayroll: expensesWithoutPayroll.reduce((s, e) => s + e.amount, 0),
    },
  };
}
