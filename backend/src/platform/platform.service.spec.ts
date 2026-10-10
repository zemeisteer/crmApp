import { describe, expect, it } from 'vitest';
import { daysLeft, lastMonths, monthEnd, monthOf } from './platform.service';

describe('platform months', () => {
  it('names a date by its UTC month', () => {
    expect(monthOf(new Date('2026-10-10T07:00:00Z'))).toBe('2026-10');
    expect(monthOf(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12');
  });

  it('lists the months ending with the given one, across a year boundary', () => {
    expect(lastMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(lastMonths('2026-10', 1)).toEqual(['2026-10']);
  });

  it('ends a paid month at the first moment of the next one', () => {
    expect(monthEnd('2026-10').toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(monthEnd('2026-12').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('daysLeft', () => {
  const now = new Date('2026-10-10T12:00:00Z');

  it('counts a trial to its end date, negative once it is over', () => {
    expect(daysLeft(now, { status: 'TRIAL', trialEndsAt: new Date('2026-10-17T12:00:00Z') }, 0, null)).toBe(7);
    expect(daysLeft(now, { status: 'TRIAL', trialEndsAt: new Date('2026-10-01T12:00:00Z') }, 300_000, null)).toBe(-9);
    expect(daysLeft(now, { status: 'TRIAL', trialEndsAt: null }, 0, null)).toBeNull();
  });

  it('has nothing to run out on a free tariff', () => {
    expect(daysLeft(now, { status: 'ACTIVE', trialEndsAt: null }, 0, null)).toBeNull();
  });

  it('counts a paid tariff to the end of the last month paid for', () => {
    expect(daysLeft(now, { status: 'ACTIVE', trialEndsAt: null }, 300_000, '2026-10')).toBe(22);
    expect(daysLeft(now, { status: 'ACTIVE', trialEndsAt: null }, 300_000, '2026-11')).toBe(52);
  });

  it('is overdue when the last paid month is behind, and due now when nothing was ever paid', () => {
    expect(daysLeft(now, { status: 'PAST_DUE', trialEndsAt: null }, 300_000, '2026-09')).toBe(-9);
    expect(daysLeft(now, { status: 'ACTIVE', trialEndsAt: null }, 300_000, null)).toBe(0);
  });
});
