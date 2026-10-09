import { describe, expect, it } from 'vitest';
import { buildCalendar, escapeText, foldLine, utcStamp } from './ics';
import { TokenCrypto } from './token-crypto';
import { providerEventId } from './calendar-sync.service';

describe('ics', () => {
  it('escapes text values', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const line = `SUMMARY:${"O'zbek tili — ".repeat(10)}`;
    const folded = foldLine(line);
    for (const part of folded.split('\r\n')) expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
    expect(folded.split('\r\n ').join('')).toBe(line);
    const cyr = foldLine(`SUMMARY:${'Отработка '.repeat(12)}`);
    expect(cyr.split('\r\n ').join('')).toBe(`SUMMARY:${'Отработка '.repeat(12)}`);
    expect(cyr).not.toContain('�');
  });

  it('writes a calendar with UTC times, CRLF line ends and cancelled events', () => {
    const start = new Date('2026-10-12T05:00:00Z');
    const body = buildCalendar({
      name: 'Center, Tashkent', domain: 'crm.example', now: new Date('2026-10-08T00:00:00Z'),
      events: [
        { uid: 'grp-g1-2026-10-12', title: 'English; B1', start, end: new Date('2026-10-12T06:00:00Z'), location: 'Room 1', description: 'T1', date: '2026-10-12' },
        { uid: 'grp-g1-2026-10-19', title: 'English', start, end: start, cancelled: true, date: '2026-10-19' },
      ],
    });
    expect(body.endsWith('\r\n')).toBe(true);
    expect(body.split('\r\n').every((l) => !l.includes('\n'))).toBe(true);
    expect(body).toContain('X-WR-CALNAME:Center\\, Tashkent');
    expect(body).toContain('UID:grp-g1-2026-10-12@crm.example');
    expect(body).toContain('DTSTART:20261012T050000Z');
    expect(body).toContain('SUMMARY:English\\; B1');
    expect(body).toMatch(/UID:grp-g1-2026-10-19@crm\.example[\s\S]*STATUS:CANCELLED/);
    expect(utcStamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('20260102T030405Z');
  });
});

describe('token crypto', () => {
  it('round-trips and refuses tampering or another key', () => {
    const a = new TokenCrypto({ CALENDAR_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') });
    const sealed = a.encrypt('ya29.secret-access-token');
    expect(sealed).not.toContain('secret');
    expect(a.decrypt(sealed)).toBe('ya29.secret-access-token');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => a.decrypt(parts.join('.'))).toThrow();
    expect(() => new TokenCrypto({ JWT_SECRET: 'x' }).decrypt(sealed)).toThrow();
    expect(() => new TokenCrypto({ CALENDAR_TOKEN_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
  });
});

describe('provider event ids', () => {
  it('are deterministic per connection and lesson, in the characters Google allows', () => {
    const a = providerEventId('conn1', 'grp-g1-2026-10-12');
    expect(a).toBe(providerEventId('conn1', 'grp-g1-2026-10-12'));
    expect(a).not.toBe(providerEventId('conn2', 'grp-g1-2026-10-12'));
    expect(a).toMatch(/^[a-v0-9]{5,1024}$/);
  });
});
