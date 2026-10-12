import { describe, expect, it } from 'vitest';
import { dayIn, lessonInstant, memberAt, memberOnDay, wasMember, type Stay } from './membership';

const stay = (from: string, until: string | null): Stay => ({ studentId: 's', groupId: 'g', startedAt: new Date(from), endedAt: until ? new Date(until) : null });

describe('membership: who was in a group, and when', () => {
  it('an instant: the start belongs to the stay, the end does not', () => {
    const s = [stay('2026-03-10T05:00:00Z', '2026-03-17T07:00:00Z')];
    expect(memberAt(s, new Date('2026-03-10T04:59:59Z'))).toBe(false);
    expect(memberAt(s, new Date('2026-03-10T05:00:00Z'))).toBe(true);
    expect(memberAt(s, new Date('2026-03-17T06:59:59Z'))).toBe(true);
    expect(memberAt(s, new Date('2026-03-17T07:00:00Z'))).toBe(false);
    expect(memberAt([stay('2026-03-10T05:00:00Z', null)], new Date('2030-01-01T00:00:00Z'))).toBe(true);
  });

  it('a day: the joining day and the leaving day both count, on the center calendar', () => {
    // 20:30 UTC on the 9th is already the 10th in Tashkent (UTC+5), still the 9th in New York.
    const s = [stay('2026-03-09T20:30:00Z', '2026-03-12T19:30:00Z')];
    expect(dayIn(new Date('2026-03-09T20:30:00Z'), 'Asia/Tashkent')).toBe('2026-03-10');
    expect(dayIn(new Date('2026-03-09T20:30:00Z'), 'America/New_York')).toBe('2026-03-09');
    expect(memberOnDay(s, '2026-03-09', 'Asia/Tashkent')).toBe(false);
    expect(memberOnDay(s, '2026-03-10', 'Asia/Tashkent')).toBe(true);
    expect(memberOnDay(s, '2026-03-13', 'Asia/Tashkent')).toBe(true); // left at 00:30 on the 13th there
    expect(memberOnDay(s, '2026-03-14', 'Asia/Tashkent')).toBe(false);
    expect(memberOnDay(s, '2026-03-09', 'America/New_York')).toBe(true);
    expect(memberOnDay(s, '2026-03-12', 'America/New_York')).toBe(true);
    expect(memberOnDay(s, '2026-03-13', 'America/New_York')).toBe(false);
  });

  it('a lesson start is an instant on the center clock; a missing or odd time gives none', () => {
    expect(lessonInstant('2026-03-10', '09:00', 'Asia/Tashkent')!.toISOString()).toBe('2026-03-10T04:00:00.000Z');
    // New York is on daylight time on that date (UTC-4).
    expect(lessonInstant('2026-03-10', '09:00', 'America/New_York')!.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(lessonInstant('2026-03-10', null, 'Asia/Tashkent')).toBeNull();
    expect(lessonInstant('2026-03-10', '9:00', 'Asia/Tashkent')).toBeNull();
    expect(lessonInstant('10.03.2026', '09:00', 'Asia/Tashkent')).toBeNull();
  });

  it('strict and lenient: a break between two stays is nobody\'s; only the time before the first known stay is open', () => {
    const tz = 'Asia/Tashkent';
    const s = [stay('2026-03-01T05:00:00Z', '2026-03-10T05:00:00Z'), stay('2026-03-20T05:00:00Z', null)];
    const at = (iso: string) => ({ date: iso.slice(0, 10), at: new Date(iso) });
    for (const mode of ['strict', 'lenient'] as const) {
      expect(wasMember(s, at('2026-03-05T05:00:00Z'), tz, mode)).toBe(true);
      expect(wasMember(s, at('2026-03-15T05:00:00Z'), tz, mode)).toBe(false); // the break
      expect(wasMember(s, at('2026-03-25T05:00:00Z'), tz, mode)).toBe(true);
      expect(wasMember([], at('2026-03-05T05:00:00Z'), tz, mode)).toBe(false);
    }
    // Before anything is known about the student in this group.
    expect(wasMember(s, at('2026-02-20T05:00:00Z'), tz, 'strict')).toBe(false);
    expect(wasMember(s, at('2026-02-20T05:00:00Z'), tz, 'lenient')).toBe(true);
    // After the last stay ended: known, and not theirs.
    const gone = [stay('2026-03-01T05:00:00Z', '2026-03-10T05:00:00Z')];
    expect(wasMember(gone, at('2026-03-11T05:00:00Z'), tz, 'lenient')).toBe(false);
    // With a date only, the day decides.
    expect(wasMember(gone, { date: '2026-03-10' }, tz, 'strict')).toBe(true);
    expect(wasMember(gone, { date: '2026-03-11' }, tz, 'lenient')).toBe(false);
    expect(wasMember(gone, { date: '2026-02-28' }, tz, 'lenient')).toBe(true);
  });
});
