import { describe, expect, it } from 'vitest';
import { formatZoned, isValidTimeZone, offsetMinutes, zonedDayBounds, zonedParts, zonedTimeToUtc } from './timezone';

describe('timezone helpers', () => {
  it('knows Tashkent is UTC+5 all year', () => {
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Tashkent')).toBe(300);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Asia/Tashkent')).toBe(300);
  });

  it('follows daylight saving time', () => {
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-240);
  });

  it('reports local wall-clock parts and ISO weekday', () => {
    // 2026-10-04T20:30Z is Monday 01:30 in Tashkent.
    expect(zonedParts(new Date('2026-10-04T20:30:00Z'), 'Asia/Tashkent')).toEqual({
      year: 2026, month: 10, day: 5, hour: 1, minute: 30, weekday: 1,
    });
  });

  it('converts local time to the right instant', () => {
    expect(zonedTimeToUtc(2026, 10, 5, 9, 0, 'Asia/Tashkent').toISOString()).toBe('2026-10-05T04:00:00.000Z');
    expect(zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York').toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('computes local day bounds, including a 23-hour DST day', () => {
    const tk = zonedDayBounds(new Date('2026-10-04T20:30:00Z'), 'Asia/Tashkent');
    expect(tk.startOfToday.toISOString()).toBe('2026-10-04T19:00:00.000Z');
    expect(tk.endOfToday.toISOString()).toBe('2026-10-05T19:00:00.000Z');
    // US spring-forward day 2026-03-08 has 23 hours.
    const ny = zonedDayBounds(new Date('2026-03-08T15:00:00Z'), 'America/New_York');
    expect((ny.endOfToday.getTime() - ny.startOfToday.getTime()) / 3_600_000).toBe(23);
  });

  it('validates zone names and formats local times', () => {
    expect(isValidTimeZone('Asia/Tashkent')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(formatZoned(new Date('2026-10-01T05:00:00Z'), 'Asia/Tashkent')).toBe('2026-10-01 10:00');
  });
});
