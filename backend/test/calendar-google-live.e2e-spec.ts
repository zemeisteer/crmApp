import { createHash } from 'crypto';
import { GoogleApiError, HttpGoogleCalendarApi, type GoogleEventBody } from '../src/calendar/google-calendar.api.js';
import { providerEventId } from '../src/calendar/calendar-sync.service.js';

// The real Google Calendar, through the adapter the app uses. Runs only when a
// test Google account's credentials are in the environment (never typed into a
// chat or committed):
//
//   GOOGLE_LIVE_CLIENT_ID, GOOGLE_LIVE_CLIENT_SECRET  - an OAuth client of a test project
//   GOOGLE_LIVE_REFRESH_TOKEN                         - a refresh token of a test account
//                                                       (scopes: calendar.events, calendar.calendarlist.readonly)
//   GOOGLE_LIVE_CALENDAR_ID                           - optional; a calendar made for this (default: primary)
//
//   npm run test:google-live
//
// What it checks is what the sync relies on: a refresh gives an access token;
// an event inserted with our id is there once - a second insert of the same id
// is a 409 (that is how a retry after a lost answer makes no copy); a patch
// changes it in place; a delete removes it (read back: gone, or "cancelled").
// It removes what it made, also when a step fails.
const env = {
  clientId: process.env.GOOGLE_LIVE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_LIVE_CLIENT_SECRET,
  refreshToken: process.env.GOOGLE_LIVE_REFRESH_TOKEN,
  calendarId: process.env.GOOGLE_LIVE_CALENDAR_ID || 'primary',
};
const live = !!(env.clientId && env.clientSecret && env.refreshToken);

describe.skipIf(!live)('Google Calendar, live (test account)', () => {
  const api = new HttpGoogleCalendarApi({ clientId: env.clientId, clientSecret: env.clientSecret });
  const key = `cev-live-${Date.now()}`;
  const id = providerEventId(`live-${createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 8)}`, key);
  let token = '';
  const start = new Date(Date.now() + 3 * 86_400_000);
  start.setUTCHours(13, 0, 0, 0); // 18:00 in Tashkent
  const body = (summary: string, hours: number): GoogleEventBody => ({
    id, summary, location: 'TalimCRM live test', description: 'Created by an automated test; deleted at its end.',
    start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + hours * 3_600_000).toISOString() },
    status: 'confirmed', extendedProperties: { private: { talimcrm: '1', key } },
  });

  afterAll(async () => {
    if (token) await api.deleteEvent(token, env.calendarId, id).catch(() => undefined);
  });

  it('refresh, list, insert once, patch in place, delete', async () => {
    const tokens = await api.refresh(env.refreshToken!);
    token = tokens.accessToken;
    expect(token).toBeTruthy();
    const calendars = await api.listCalendars(token);
    expect(calendars.length).toBeGreaterThan(0);
    if (env.calendarId !== 'primary') expect(calendars.map((c) => c.id)).toContain(env.calendarId);

    expect((await api.insertEvent(token, env.calendarId, body('TalimCRM live: majlis', 1))).id).toBe(id);
    const again = await api.insertEvent(token, env.calendarId, body('TalimCRM live: majlis', 1)).then(() => null, (e: unknown) => e);
    expect(again).toBeInstanceOf(GoogleApiError);
    expect((again as GoogleApiError).status).toBe(409);

    expect((await api.patchEvent(token, env.calendarId, id, body("TalimCRM live: majlis (ko'chirildi)", 2))).id).toBe(id);

    await api.deleteEvent(token, env.calendarId, id);
    // Read it back directly: Google answers 404/410, or keeps it as "cancelled".
    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.calendarId)}/events/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.ok) expect(((await res.json()) as { status?: string }).status).toBe('cancelled');
    else expect([404, 410]).toContain(res.status);
  });
});

describe.skipIf(live)('Google Calendar, live (test account)', () => {
  it.skip('BLOCKED: GOOGLE_LIVE_CLIENT_ID / GOOGLE_LIVE_CLIENT_SECRET / GOOGLE_LIVE_REFRESH_TOKEN are not set', () => undefined);
});
