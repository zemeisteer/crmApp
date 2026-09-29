import { describe, it, expect } from 'vitest';
import { directorReport, expectedFor, type DrStudent } from './director-report';

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
const enr = (joined: string, price: number, extra: Partial<DrStudent['enrollments'][number]> = {}) => ({
  status: 'ACTIVE', joinedMonth: joined, leftMonth: null, price, groupName: 'G', ...extra,
});

describe('expectedFor', () => {
  it('counts an enrollment from the month it started, not before', () => {
    const s = st({ enrollments: [enr('2026-03', 500)] });
    expect(expectedFor(s, '2026-02', '2026-06')).toBe(0);
    expect(expectedFor(s, '2026-03', '2026-06')).toBe(500);
  });

  it('includes the month a student left, not the ones after', () => {
    const s = st({ status: 'LEFT', leftMonth: '2026-04', enrollments: [enr('2026-01', 300, { status: 'CANCELLED', leftMonth: '2026-04' })] });
    expect(expectedFor(s, '2026-04', '2026-06')).toBe(300);
    expect(expectedFor(s, '2026-05', '2026-06')).toBe(0);
    expect(expectedFor(s, '2026-06', '2026-06')).toBe(0); // current month: not active now
  });

  it('never invents debt for paused or ended-without-date enrollments', () => {
    const s = st({ enrollments: [enr('2026-01', 400, { status: 'PAUSED' }), enr('2026-01', 200, { status: 'COMPLETED' })] });
    expect(expectedFor(s, '2026-03', '2026-06')).toBe(0);
  });
});

describe('directorReport', () => {
  const base = {
    month: '2026-06',
    currentMonth: '2026-06',
    expensesByMonth: { '2026-06': 100 },
    salariesByMonth: { '2026-06': 200 },
    includeProfit: true,
  };

  it('builds up debt over months and lists the biggest debtor first', () => {
    const a = st({ id: 'a', fullName: 'Aziz', enrollments: [enr('2026-04', 500)] });
    const b = st({ id: 'b', fullName: 'Bekzod', enrollments: [enr('2026-06', 500)] });
    const r = directorReport({
      ...base,
      students: [a, b],
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
    const a = st({ id: 'a', enrollments: [enr('2026-06', 500)] });
    const r = directorReport({ ...base, includeProfit: false, students: [a], payments: [{ studentId: 'a', forMonth: '2026-06', amount: 400, discount: 100, paidAt: null }] });
    expect(r.debtors.count).toBe(0);
    expect(r.trend.at(-1)).not.toHaveProperty('net');
  });

  it('measures churn against students active at the start of the month, with reasons', () => {
    const stay = st({ id: 's1', createdMonth: '2026-01' });
    const gone = st({ id: 's2', createdMonth: '2026-02', status: 'LEFT', leftMonth: '2026-06', leftAt: new Date('2026-06-10'), leftReason: 'PRICE', enrollments: [enr('2026-02', 1, { groupName: 'IELTS', status: 'CANCELLED', leftMonth: '2026-06' })] });
    const earlier = st({ id: 's3', createdMonth: '2026-01', status: 'LEFT', leftMonth: '2026-05', leftReason: null });
    const fresh = st({ id: 's4', createdMonth: '2026-06' });
    const r = directorReport({ ...base, students: [stay, gone, earlier, fresh], payments: [] });
    expect(r.churn).toMatchObject({ left: 1, activeAtStart: 2, rate: 50 });
    expect(r.churn.leavers).toEqual([expect.objectContaining({ fullName: 'S', reason: 'PRICE', groups: ['IELTS'], monthsStudied: 4 })]);
    expect(r.churn.reasonsLast3Months).toEqual({ PRICE: 1, UNKNOWN: 1 });
    expect(r.trend.at(-1)!.newStudents).toBe(1);
  });
});
