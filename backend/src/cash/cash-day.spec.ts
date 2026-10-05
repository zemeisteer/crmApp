import { describe, expect, it } from 'vitest';
import { cashDay } from './cash-day';

const t = (iso: string) => new Date(iso);
const pay = (id: string, amount: number, method: string, by: string | null, at = '2026-10-05T06:00:00Z') => ({
  id, amount, method, paidAt: t(at), createdAt: t(at), studentName: `S ${id}`, recordedById: by, recordedByName: by ? `User ${by}` : null,
});
const exp = (id: string, amount: number, paymentMethod: string, at = '2026-10-05T08:00:00Z') => ({ id, title: id, amount, paymentMethod, category: 'OTHER', createdAt: t(at) });

describe('cashDay', () => {
  it('cash in the drawer is cash taken minus cash spent; other methods never pass through it', () => {
    const d = cashDay('2026-10-05', 'Asia/Tashkent', [
      pay('a', 300_000, 'CASH', 'u1'),
      pay('b', 200_000, 'CLICK', 'u1'),
      pay('c', 100_000, 'CASH', 'u2'),
      pay('d', 50_000, 'PAYME', null),
    ], [exp('rent', 120_000, 'BANK_TRANSFER'), exp('chalk', 30_000, 'CASH'), exp('salary', 100_000, 'CASH')], null);
    expect(d.in.CASH).toEqual({ amount: 400_000, count: 2 });
    expect(d.in.CLICK.amount + d.in.PAYME.amount).toBe(250_000);
    expect(d.out.CASH).toEqual({ amount: 130_000, count: 2 });
    expect(d.totalIn).toBe(650_000);
    expect(d.totalOut).toBe(250_000);
    expect(d.expectedCash).toBe(270_000);
    expect(d.byCashier).toEqual([
      { userId: 'u1', name: 'User u1', cash: 300_000, other: 200_000, count: 2 },
      { userId: 'u2', name: 'User u2', cash: 100_000, other: 0, count: 1 },
      { userId: null, name: null, cash: 0, other: 50_000, count: 1 },
    ]);
  });

  it('marks what was recorded after the day was closed', () => {
    const d = cashDay('2026-10-05', 'Asia/Tashkent', [pay('a', 1, 'CASH', 'u1', '2026-10-05T06:00:00Z'), pay('b', 2, 'CASH', 'u1', '2026-10-05T12:00:00Z')], [exp('e', 3, 'CASH', '2026-10-05T13:00:00Z')], t('2026-10-05T10:00:00Z'));
    expect(d.payments.map((p) => [p.id, p.afterClosing])).toEqual([['a', false], ['b', true]]);
    expect(d.expenses[0].afterClosing).toBe(true);
    expect(cashDay('2026-10-05', 'Asia/Tashkent', [], [], null)).toMatchObject({ totalIn: 0, totalOut: 0, expectedCash: 0, byCashier: [] });
  });
});
