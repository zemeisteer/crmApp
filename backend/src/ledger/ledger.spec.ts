import { describe, it, expect } from 'vitest';
import { enrollmentOwes, monthDue, priceAt, type LedgerEnrollment, type LedgerStudent } from './ledger';

const enr = (over: Partial<LedgerEnrollment> = {}): LedgerEnrollment => ({
  id: 'e1',
  groupId: 'g1',
  groupName: 'English',
  status: 'ACTIVE',
  joinedMonth: '2026-01',
  leftMonth: null,
  groupDeletedMonth: null,
  prices: [{ from: '2026-01', price: 500 }],
  ...over,
});
const st = (over: Partial<LedgerStudent> = {}): LedgerStudent => ({
  id: 's1',
  status: 'ACTIVE',
  leftMonth: null,
  pausedMonth: null,
  deletedMonth: null,
  enrollments: [enr()],
  ...over,
});
const inv = (amount: number, amountPaid = 0, remainingAmount = amount - amountPaid, enrollmentId: string | null = 'e1') => ({ enrollmentId, amount, amountPaid, remainingAmount });
const pay = (amount: number, allocated: number | null = null, discount = 0) => ({ amount, discount, allocated });

describe('priceAt', () => {
  const prices = [{ from: '2026-01', price: 500 }, { from: '2026-04', price: 650 }];
  it('uses the price that was in force in that month, not the latest', () => {
    expect(priceAt(prices, '2026-03')).toBe(500);
    expect(priceAt(prices, '2026-04')).toBe(650);
    expect(priceAt(prices, '2026-09')).toBe(650);
  });
  it('falls back to the earliest known price before the first record', () => {
    expect(priceAt(prices, '2025-11')).toBe(500);
    expect(priceAt([], '2026-01')).toBe(0);
  });
});

describe('enrollmentOwes', () => {
  it('starts with the month of joining', () => {
    expect(enrollmentOwes(st(), enr({ joinedMonth: '2026-03' }), '2026-02')).toBe(false);
    expect(enrollmentOwes(st(), enr({ joinedMonth: '2026-03' }), '2026-03')).toBe(true);
  });

  it('keeps the months before a student left, graduated, paused or was removed', () => {
    for (const s of [
      st({ status: 'LEFT', leftMonth: '2026-05' }),
      st({ status: 'GRADUATED', leftMonth: '2026-05' }),
      st({ status: 'PAUSED', pausedMonth: '2026-05' }),
      st({ deletedMonth: '2026-05' }),
    ]) {
      expect(enrollmentOwes(s, s.enrollments[0], '2026-04')).toBe(true);
      // The month of leaving itself is not charged without an invoice.
      expect(enrollmentOwes(s, s.enrollments[0], '2026-05')).toBe(false);
      expect(enrollmentOwes(s, s.enrollments[0], '2026-06')).toBe(false);
    }
  });

  it('never invents debt when the date was not recorded', () => {
    expect(enrollmentOwes(st({ status: 'LEFT' }), enr(), '2026-02')).toBe(false);
    expect(enrollmentOwes(st({ status: 'PAUSED' }), enr(), '2026-02')).toBe(false);
    expect(enrollmentOwes(st(), enr({ status: 'CANCELLED' }), '2026-02')).toBe(false);
    expect(enrollmentOwes(st(), enr({ status: 'PAUSED' }), '2026-02')).toBe(false);
  });

  it('ends with the enrollment or the group', () => {
    expect(enrollmentOwes(st(), enr({ status: 'CANCELLED', leftMonth: '2026-04' }), '2026-03')).toBe(true);
    expect(enrollmentOwes(st(), enr({ status: 'CANCELLED', leftMonth: '2026-04' }), '2026-04')).toBe(false);
    expect(enrollmentOwes(st(), enr({ groupDeletedMonth: '2026-04' }), '2026-04')).toBe(false);
  });
});

describe('monthDue', () => {
  it('without invoices: enrollments in force at the price of that month', () => {
    const s = st({ enrollments: [enr({ prices: [{ from: '2026-01', price: 500 }, { from: '2026-06', price: 700 }] })] });
    expect(monthDue(s, '2026-03', [], [])).toMatchObject({ expected: 500, debt: 500, estimated: 500 });
    expect(monthDue(s, '2026-06', [], [pay(300)])).toMatchObject({ expected: 700, paid: 300, debt: 400 });
  });

  it('an invoice fixes the amount, whatever the price or status is now', () => {
    const s = st({ status: 'LEFT', leftMonth: '2026-02', enrollments: [enr({ status: 'CANCELLED', leftMonth: '2026-02', prices: [{ from: '2026-01', price: 900 }] })] });
    const due = monthDue(s, '2026-02', [inv(500, 200)], [pay(200, 200)]);
    expect(due).toMatchObject({ expected: 500, paid: 200, debt: 300, estimated: 0 });
    expect(due.groups).toEqual([{ id: 'g1', name: 'English', monthlyPrice: 500 }]);
  });

  it('several groups: invoiced ones by invoice, the rest by enrollment', () => {
    const s = st({ enrollments: [enr(), enr({ id: 'e2', groupId: 'g2', groupName: 'Math', prices: [{ from: '2026-01', price: 400 }] })] });
    const due = monthDue(s, '2026-03', [inv(500, 500, 0)], [pay(500, 500)]);
    expect(due).toMatchObject({ expected: 900, paid: 500, debt: 400, estimated: 400 });
    expect(due.groups.map((g) => g.name)).toEqual(['English', 'Math']);
  });

  it('an invoice not tied to a group stands for the whole month', () => {
    const due = monthDue(st(), '2026-03', [inv(450, 0, 450, null)], []);
    expect(due).toMatchObject({ expected: 450, debt: 450, estimated: 0 });
  });

  it('a discount given with a payment closes the invoice and is not counted twice', () => {
    // 500 invoice: 400 paid + 100 waived.
    const due = monthDue(st(), '2026-03', [inv(500, 400, 0)], [pay(400, 400, 100)]);
    expect(due).toMatchObject({ expected: 500, discount: 100, paid: 400, debt: 0 });
  });

  it('legacy payments with no allocation still count for their month, read-only', () => {
    // An old payment that was never linked to the invoice issued later.
    const due = monthDue(st(), '2026-03', [inv(500)], [pay(300, null, 50)]);
    expect(due).toMatchObject({ expected: 500, discount: 50, paid: 300, debt: 150 });
  });

  it('paying more than was owed never produces negative debt', () => {
    expect(monthDue(st(), '2026-03', [], [pay(800)])).toMatchObject({ expected: 500, paid: 800, debt: 0 });
  });

  it('a student with nothing in force and nothing invoiced owes nothing', () => {
    const s = st({ status: 'LEFT', leftMonth: '2026-02' });
    expect(monthDue(s, '2026-05', [], [])).toMatchObject({ expected: 0, debt: 0, groups: [] });
  });
});
