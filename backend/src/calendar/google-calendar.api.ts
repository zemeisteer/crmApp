// The Google side of the calendar sync, behind an interface so tests (and a
// local mock server, via GOOGLE_OAUTH_BASE / GOOGLE_CALENDAR_API_BASE) never
// reach Google. Only the calls the outbound sync needs.

export const GOOGLE_CALENDAR_API = Symbol('GOOGLE_CALENDAR_API');

/** Least privilege: write events, read the calendar list (to choose one). */
export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly'];

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface GoogleEventBody {
  id?: string;
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  status?: 'confirmed' | 'cancelled';
  extendedProperties?: { private: Record<string, string> };
}

export interface GoogleCalendarApi {
  authUrl(params: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(code: string, verifier: string, redirectUri: string): Promise<GoogleTokens>;
  refresh(refreshToken: string): Promise<GoogleTokens>;
  revoke(token: string): Promise<void>;
  listCalendars(accessToken: string): Promise<{ id: string; summary: string; primary?: boolean }[]>;
  insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<{ id: string }>;
  patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody): Promise<{ id: string }>;
  deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void>;
}

/**
 * A failed provider call. `retryable`: rate limit, server error, network -
 * try again later with backoff. `auth`: the grant is gone (revoked, expired)
 * - the user must reconnect. `status` 404/409/410 are handled by the sync.
 */
export class GoogleApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean, readonly auth: boolean) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export class HttpGoogleCalendarApi implements GoogleCalendarApi {
  constructor(
    private readonly creds: { clientId?: string; clientSecret?: string },
    private readonly oauthBase = 'https://oauth2.googleapis.com',
    private readonly authBase = 'https://accounts.google.com',
    private readonly apiBase = 'https://www.googleapis.com/calendar/v3',
  ) {}

  authUrl(p: { clientId: string; redirectUri: string; state: string; codeChallenge: string }) {
    const q = new URLSearchParams({
      client_id: p.clientId, redirect_uri: p.redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: p.state,
      code_challenge: p.codeChallenge, code_challenge_method: 'S256',
    });
    return `${this.authBase}/o/oauth2/v2/auth?${q}`;
  }

  private async call(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
    } catch (err) {
      throw new GoogleApiError(`network: ${(err as Error).name}`, 0, true, false);
    }
    return res;
  }

  private async fail(res: Response): Promise<never> {
    let reason = '';
    try {
      const body = (await res.json()) as { error?: string | { message?: string; status?: string }; error_description?: string };
      reason = typeof body.error === 'string' ? body.error : body.error?.status || body.error?.message || '';
    } catch {
      // no JSON body
    }
    const auth = res.status === 401 || reason === 'invalid_grant' || reason === 'unauthorized_client';
    const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && /rate/i.test(reason));
    throw new GoogleApiError(`google ${res.status}${reason ? ` ${reason}` : ''}`, res.status, retryable, auth);
  }

  private async token(params: Record<string, string>): Promise<GoogleTokens> {
    const res = await this.call(`${this.oauthBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.creds.clientId ?? '', client_secret: this.creds.clientSecret ?? '', ...params }),
    });
    if (!res.ok) await this.fail(res);
    const b = (await res.json()) as { access_token: string; refresh_token?: string; expires_in?: number };
    return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt: new Date(Date.now() + (b.expires_in ?? 3600) * 1000) };
  }

  exchangeCode(code: string, verifier: string, redirectUri: string) {
    return this.token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri });
  }

  refresh(refreshToken: string) {
    return this.token({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async revoke(token: string) {
    await this.call(`${this.oauthBase}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
  }

  async listCalendars(accessToken: string) {
    const res = await this.call(`${this.apiBase}/users/me/calendarList?minAccessRole=writer&maxResults=100`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) await this.fail(res);
    const b = (await res.json()) as { items?: { id: string; summary: string; primary?: boolean }[] };
    return (b.items ?? []).map((c) => ({ id: c.id, summary: c.summary, primary: c.primary }));
  }

  async insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody) {
    const res = await this.call(`${this.apiBase}/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res);
    return { id: ((await res.json()) as { id: string }).id };
  }

  async patchEvent(accessToken: string, calendarId: string, eventId: string, body: GoogleEventBody) {
    const res = await this.call(`${this.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res);
    return { id: ((await res.json()) as { id: string }).id };
  }

  async deleteEvent(accessToken: string, calendarId: string, eventId: string) {
    const res = await this.call(`${this.apiBase}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok && res.status !== 404 && res.status !== 410) await this.fail(res);
  }
}
