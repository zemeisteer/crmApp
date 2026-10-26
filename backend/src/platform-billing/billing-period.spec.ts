import { describe, expect, it } from 'vitest';
import { addMonth, assertRecordableMonth, isMonthLabel, monthLabelOf, nextMonthLabel, paymentMonth } from './billing-period';

const TZ = 'Asia/Tashkent'; // UTC+5
const none = new Set<string>();

describe('month labels', () => {
  it('accepts only real months', () => {
    expect(isMonthLabel('2026-01')).toBe(true);
    expect(isMonthLabel('2026-12')).toBe(true);
    for (const bad of ['2026-00', '2026-13', '2026-1', '26-01', '2026-01-01', '', null, 202601]) expect(isMonthLabel(bad)).toBe(false);
  });

  it('rolls over the year', () => {
    expect(nextMonthLabel('2026-12')).toBe('2027-01');
    expect(nextMonthLabel('2026-01')).toBe('2026-02');
  });

  it("takes the month in the center's time zone, not UTC", () => {
    // 31 Oct 2026, 20:00 UTC is already 1 Nov, 01:00 in Tashkent.
    expect(monthLabelOf(new Date('2026-10-31T20:00:00Z'), TZ)).toBe('2026-11');
    expect(monthLabelOf(new Date('2026-10-31T18:59:00Z'), TZ)).toBe('2026-10');
    // An unknown zone falls back to the default instead of failing.
    expect(monthLabelOf(new Date('2026-10-31T20:00:00Z'), 'Mars/Base')).toBe('2026-11');
  });
});

describe('paymentMonth: which month a new payment is for', () => {
  const now = new Date('2026-10-26T07:00:00Z');

  it('never paid, or the paid time has run out: this month', () => {
    expect(paymentMonth(null, now, TZ, none)).toBe('2026-10');
    expect(paymentMonth(new Date('2026-09-15T00:00:00Z'), now, TZ, none)).toBe('2026-10');
  });

  it('paying early: the month the paid time runs out in', () => {
    expect(paymentMonth(new Date('2026-11-26T07:00:00Z'), now, TZ, new Set(['2026-10']))).toBe('2026-11');
    // Across the year end.
    expect(paymentMonth(new Date('2027-01-03T00:00:00Z'), now, TZ, none)).toBe('2027-01');
  });

  it('skips months already paid (e.g. by hand)', () => {
    expect(paymentMonth(null, now, TZ, new Set(['2026-10', '2026-11']))).toBe('2026-12');
    expect(paymentMonth(null, new Date('2026-12-10T00:00:00Z'), TZ, new Set(['2026-12']))).toBe('2027-01');
  });

  it('each payment in a row gets a new label (the paid time moves on a month each time)', () => {
    let paidUntil: Date | null = null;
    const labels = new Set<string>();
    for (let i = 0; i < 14; i++) {
      const label = paymentMonth(paidUntil, now, TZ, labels);
      expect(labels.has(label)).toBe(false);
      labels.add(label);
      paidUntil = addMonth(paidUntil && paidUntil > now ? paidUntil : now);
    }
    expect(labels.size).toBe(14);
  });
});

describe('addMonth', () => {
  it('31 January becomes the last day of February, leap years included', () => {
    expect(addMonth(new Date('2027-01-31T10:00:00Z')).toISOString()).toBe('2027-02-28T10:00:00.000Z');
    expect(addMonth(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonth(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe('2027-01-31T10:00:00.000Z');
  });
});

describe('assertRecordableMonth', () => {
  const now = new Date('2026-10-26T07:00:00Z');
  it('a real month within two years back and one year ahead', () => {
    expect(assertRecordableMonth('2026-10', now)).toBe('2026-10');
    expect(assertRecordableMonth('2024-10', now)).toBe('2024-10');
    expect(assertRecordableMonth('2027-10', now)).toBe('2027-10');
    expect(() => assertRecordableMonth('2026-13', now)).toThrow();
    expect(() => assertRecordableMonth('2026-00', now)).toThrow();
    expect(() => assertRecordableMonth('2024-09', now)).toThrow();
    expect(() => assertRecordableMonth('2027-11', now)).toThrow();
  });
});
