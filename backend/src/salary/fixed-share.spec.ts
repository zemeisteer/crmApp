import { fixedShare } from './fixed-share';

describe('fixedShare', () => {
  const tz = 'Asia/Tashkent';
  it('the whole month when started before it or with no date', () => {
    expect(fixedShare(3_000_000, null, '2026-11', tz).amount).toBe(3_000_000);
    expect(fixedShare(3_000_000, new Date('2026-10-15T05:00:00Z'), '2026-11', tz).amount).toBe(3_000_000);
    expect(fixedShare(3_000_000, new Date('2026-10-31T20:00:00Z'), '2026-11', tz).amount).toBe(3_000_000); // 1 Nov in Tashkent
  });
  it('from the start day when started in the month; nothing when started later', () => {
    // 7 November: 24 of 30 days.
    expect(fixedShare(3_000_000, new Date('2026-11-07T04:00:00Z'), '2026-11', tz)).toEqual({ amount: 2_400_000, fromDay: 7 });
    expect(fixedShare(3_000_000, new Date('2026-12-01T04:00:00Z'), '2026-11', tz).amount).toBe(0);
  });
});
