import { describe, it, expect } from 'vitest';
import { directorReport, type DrDue, type DrStudent } from './director-report';

const st = (over: Partial<DrStudent>): DrStudent => ({
  id: 's',
  fullName: 'S',
  phone: null,
  parentPhone: null,
  status: 'ACTIVE',
  createdMonth: '2026-01',
  leftMonth: null,
  leftAt: null,
  leftReason: null,
  enrollments: [],
  ...over,
});
const enr = (extra: Partial<DrStudent['enrollments'][number]> = {}) => ({ status: 'ACTIVE', groupName: 'G', ...extra });
// The ledger's answer, keyed "student|month" -> [expected, discount, debt].
const dueFrom = (table: Record<string, [number, number, number]>): DrDue => (id, month) => {
  const [expected, discount, debt] = table[`${id}|${month}`] ?? [0, 0, 0];
  return { expected, discount, debt };
};

describe('directorReport', () => {
  const base = {
    month: '2026-06',
    currentMonth: '2026-06',
    expensesByMonth: { '2026-06': 100 },
    salariesByMonth: { '2026-06': 200 },
    includeProfit: true,
  };

  it('builds up debt over months and lists the biggest debtor first', () => {
    const a = st({ id: 'a', fullName: 'Aziz', enrollments: [enr()] });
    const b = st({ id: 'b', fullName: 'Bekzod', enrollments: [enr()] });
    const r = directorReport({
      ...base,
      students: [a, b],
      due: dueFrom({ 'a|2026-04': [500, 0, 0], 'a|2026-05': [500, 0, 500], 'a|2026-06': [500, 0, 500], 'b|2026-06': [500, 0, 300] }),
      payments: [
        { studentId: 'a', forMonth: '2026-04', amount: 500, discount: 0, paidAt: new Date('2026-04-05') },
        { studentId: 'b', forMonth: '2026-06', amount: 200, discount: 0, paidAt: new Date('2026-06-03') },
      ],
    });
    expect(r.debtors.items.map((d) => [d.fullName, d.totalDebt, d.monthsBehind, d.oldestMonth])).toEqual([
      ['Aziz', 1000, 2, '2026-05'],
      ['Bekzod', 300, 1, '2026-06'],
    ]);
    expect(r.debtors).toMatchObject({ totalDebt: 1300, count: 2, multiMonth: 1 });
    const june = r.trend.at(-1)!;
    expect(june).toMatchObject({ month: '2026-06', expected: 1000, collected: 200, debt: 800, collectionRate: 20, net: -100 });
  });

  it('respects discounts and leaves profit out when not allowed', () => {
    const a = st({ id: 'a', enrollments: [enr()] });
    const r = directorReport({ ...base, includeProfit: false, students: [a], due: dueFrom({ 'a|2026-06': [500, 100, 0] }), payments: [{ studentId: 'a', forMonth: '2026-06', amount: 400, discount: 100, paidAt: null }] });
    expect(r.debtors.count).toBe(0);
    expect(r.trend.at(-1)).not.toHaveProperty('net');
  });

  it('measures churn against students active at the start of the month, with reasons', () => {
    const stay = st({ id: 's1', createdMonth: '2026-01' });
    const gone = st({ id: 's2', createdMonth: '2026-02', status: 'LEFT', leftMonth: '2026-06', leftAt: new Date('2026-06-10'), leftReason: 'PRICE', enrollments: [enr({ groupName: 'IELTS', status: 'CANCELLED' })] });
    const earlier = st({ id: 's3', createdMonth: '2026-01', status: 'LEFT', leftMonth: '2026-05', leftReason: null });
    const fresh = st({ id: 's4', createdMonth: '2026-06' });
    // A removed student still owes, but is not part of the churn figures.
    const removed = st({ id: 's5', createdMonth: '2026-01', deleted: true });
    const r = directorReport({ ...base, students: [stay, gone, earlier, fresh, removed], payments: [], due: dueFrom({ 's5|2026-05': [400, 0, 400] }) });
    expect(r.debtors.items.map((d) => [d.studentId, d.totalDebt])).toEqual([['s5', 400]]);
    expect(r.churn).toMatchObject({ left: 1, activeAtStart: 2, rate: 50 });
    expect(r.churn.leavers).toEqual([expect.objectContaining({ fullName: 'S', reason: 'PRICE', groups: ['IELTS'], monthsStudied: 4 })]);
    expect(r.churn.reasonsLast3Months).toEqual({ PRICE: 1, UNKNOWN: 1 });
    expect(r.trend.at(-1)!.newStudents).toBe(1);
  });
});
