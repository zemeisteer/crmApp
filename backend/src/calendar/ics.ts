// A minimal RFC 5545 writer for read-only subscription calendars. Times are
// written in UTC (Z), so every client shows them in its own zone correctly
// whatever it knows about the center's.

export interface CalEvent {
  uid: string; // stable per lesson occurrence
  title: string;
  start: Date;
  end: Date;
  location?: string | null;
  description?: string | null;
  cancelled?: boolean;
  /** YYYY-MM-DD of the lesson (center-local), for windowing and sync bookkeeping. */
  date: string;
}

const CRLF = '\r\n';

/** TEXT value escaping (RFC 5545 3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds a content line at 75 octets, never inside a UTF-8 character (RFC 5545 3.1). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      limit = 74; // continuation lines start with a space
    }
    current += ch;
    bytes += n;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

export function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildCalendar(opts: { name: string; domain: string; events: CalEvent[]; now?: Date }): string {
  const now = utcStamp(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TalimCRM//Lessons//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    // A hint for clients that honour it; the actual refresh is up to the client.
    'REFRESH-INTERVAL;VALUE=DURATION:PT6H',
    'X-PUBLISHED-TTL:PT6H',
  ];
  for (const e of opts.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@${opts.domain}`,
      `DTSTAMP:${now}`,
      `DTSTART:${utcStamp(e.start)}`,
      `DTEND:${utcStamp(e.end)}`,
      `SUMMARY:${escapeText(e.title)}`,
    );
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push(`STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, `SEQUENCE:${e.cancelled ? 1 : 0}`, 'TRANSP:OPAQUE', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}
