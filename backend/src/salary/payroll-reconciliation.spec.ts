import { describe, expect, it } from 'vitest';
import { reconcileLegacyPayroll, salaryExpenseTitle } from './payroll-reconciliation';

const row = (id: string, teacherName: string, forMonth: string, amount: number) => ({
  id,
  teacherId: `t-${teacherName}`,
  teacherName,
  forMonth,
  amount,
  paidAt: new Date(`${forMonth}-25T10:00:00Z`),
});
const exp = (id: string, title: string, amount: number, date: string) => ({ id, title, amount, date });

describe('reconcileLegacyPayroll', () => {
  it('classifies old salary rows against unlinked SALARY expenses by their title', () => {
    const r = reconcileLegacyPayroll(
      [
        row('sp-a', 'Ali', '2026-08', 3_000_000), // one payout, one expense: same money twice in totals
        row('sp-b', 'Vali', '2026-08', 1_000_000), // two payouts overwrote the row: it holds the last one
        row('sp-c', 'Soli', '2026-08', 2_000_000), // "mark as paid": no expense at all
      ],
      [
        exp('e-1', salaryExpenseTitle('Ali', '2026-08'), 3_000_000, '2026-08-25'),
        exp('e-2', salaryExpenseTitle('Vali', '2026-08'), 1_500_000, '2026-08-10'),
        exp('e-3', salaryExpenseTitle('Vali', '2026-08'), 1_000_000, '2026-08-25'),
        exp('e-4', 'Bonus', 200_000, '2026-08-30'), // a salary expense entered by hand
        exp('e-5', 'Bonus', 100_000, '2026-07-30'),
      ],
      '2026-08',
    );
    const by = (id: string) => r.items.find((i) => i.salaryPaymentId === id)!;
    expect(by('sp-a')).toMatchObject({ status: 'LIKELY_DOUBLE_COUNTED', matchedExpenseTotal: 3_000_000, difference: 0 });
    expect(by('sp-b')).toMatchObject({ status: 'AMOUNT_MISMATCH', matchedExpenseTotal: 2_500_000, difference: 1_500_000 });
    expect(by('sp-b').matchedExpenses.map((e) => e.id)).toEqual(['e-2', 'e-3']);
    expect(by('sp-c')).toMatchObject({ status: 'NO_EXPENSE', matchedExpenseTotal: 0, matchedExpenses: [] });
    // Only the month asked for; July's hand-entered expense is not listed.
    expect(r.expensesWithoutPayroll.map((e) => e.id)).toEqual(['e-4']);
    expect(r.totals).toEqual({ legacyRows: 3, likelyDoubleCounted: 3_000_000, mismatched: 1, withoutExpense: 1, expensesWithoutPayroll: 200_000 });
  });

  it('never gives one expense to two rows, and an empty input is an empty report', () => {
    const r = reconcileLegacyPayroll(
      [row('sp-1', 'Ali', '2026-08', 500), row('sp-2', 'Ali', '2026-08', 500)],
      [exp('e-1', salaryExpenseTitle('Ali', '2026-08'), 500, '2026-08-01')],
    );
    expect(r.items.map((i) => i.status)).toEqual(['LIKELY_DOUBLE_COUNTED', 'NO_EXPENSE']);
    expect(r.forMonth).toBeNull();
    expect(reconcileLegacyPayroll([], []).totals).toEqual({ legacyRows: 0, likelyDoubleCounted: 0, mismatched: 0, withoutExpense: 0, expensesWithoutPayroll: 0 });
  });
});
