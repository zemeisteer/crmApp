// A local stand-in for the parts of Google the calendar sync talks to, for
// the Google browser suite (playwright.google.config.ts). Nothing here
// reaches Google. Like backend/test/calendar.e2e-spec.ts's FakeGoogle, but
// over HTTP, so the real HttpGoogleCalendarApi (backend/src/calendar/
// google-calendar.api.ts) is what the backend runs:
//
//   GET  /o/oauth2/v2/auth                 consent: redirects straight back with code and state
//   POST /token                            authorization_code (PKCE checked) and refresh_token grants
//   POST /revoke                           revokes a token
//   GET  /calendar/v3/users/me/calendarList
//   POST/PATCH/DELETE /calendar/v3/calendars/:id/events[/:eventId]
//
// For the tests: GET /__fake/state (recorded calls, stored events, revoked
// tokens), POST /__fake/mode ({ refresh: 'ok' | 'invalid_grant', events:
// 'ok' | 'down' }), POST /__fake/reset, GET /__fake/health.
const http = require('http');
const { createHash, randomBytes } = require('crypto');

const PORT = Number(process.env.BROWSER_FAKE_GOOGLE_PORT || 4399);
const CLIENT_ID = 'browser-test-client';
const CLIENT_SECRET = 'browser-test-secret';
const CALENDARS = [
  { id: 'primary', summary: 'zzbr-owner@example.test', primary: true },
  { id: 'lessons@group.calendar.example', summary: 'Darslar' },
];
// Shorter than the backend's one-minute margin: every use refreshes, so the
// refresh grant is exercised on every sync.
const ACCESS_TTL_S = 30;

let state;
function reset() {
  state = {
    codes: new Map(), // code -> { challenge, redirectUri }
    refresh: new Map(), // refresh token -> { revoked }
    access: new Map(), // access token -> expires (ms)
    events: new Map(CALENDARS.map((c) => [c.id, new Map()])),
    calls: [],
    revoked: [],
    mode: { refresh: 'ok', events: 'ok' },
  };
}
reset();

const token = (kind) => `fake-${kind}-${randomBytes(12).toString('hex')}`;
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function record(call, status) {
  state.calls.push({ ...call, status, at: Date.now() });
  return status;
}

function bearerOk(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const exp = m && state.access.get(m[1]);
  return !!exp && exp > Date.now();
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  // ---- test controls ----
  if (path === '/__fake/health') return send(res, 200, { ok: true });
  if (path === '/__fake/reset' && req.method === 'POST') {
    reset();
    return send(res, 200, { ok: true });
  }
  if (path === '/__fake/mode' && req.method === 'POST') {
    Object.assign(state.mode, JSON.parse((await readBody(req)) || '{}'));
    return send(res, 200, state.mode);
  }
  if (path === '/__fake/state') {
    return send(res, 200, {
      calls: state.calls,
      revoked: state.revoked,
      mode: state.mode,
      calendars: Object.fromEntries([...state.events].map(([id, m]) => [id, [...m.values()]])),
    });
  }

  // ---- consent screen: answers at once, as if the user had agreed ----
  if (path === '/o/oauth2/v2/auth' && req.method === 'GET') {
    const q = Object.fromEntries(url.searchParams);
    const call = { op: 'authorize', clientId: q.client_id, redirectUri: q.redirect_uri, scope: q.scope, accessType: q.access_type, challengeMethod: q.code_challenge_method, hasState: !!q.state };
    if (q.client_id !== CLIENT_ID || q.response_type !== 'code' || !q.redirect_uri || !q.state || !q.code_challenge || q.code_challenge_method !== 'S256') {
      return send(res, record(call, 400), 'invalid_request');
    }
    const code = token('code');
    state.codes.set(code, { challenge: q.code_challenge, redirectUri: q.redirect_uri });
    const back = new URL(q.redirect_uri);
    back.searchParams.set('code', code);
    back.searchParams.set('state', q.state);
    return send(res, record(call, 302), '', { Location: back.toString() });
  }

  // ---- OAuth token endpoint ----
  if (path === '/token' && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const call = { op: `token:${f.grant_type}` };
    if (f.client_id !== CLIENT_ID || f.client_secret !== CLIENT_SECRET) return send(res, record(call, 401), { error: 'invalid_client' });
    if (f.grant_type === 'authorization_code') {
      const c = state.codes.get(f.code);
      state.codes.delete(f.code);
      const pkce = !!c && !!f.code_verifier && b64url(createHash('sha256').update(f.code_verifier).digest()) === c.challenge;
      call.pkce = pkce;
      if (!c || !pkce || f.redirect_uri !== c.redirectUri) return send(res, record(call, 400), { error: 'invalid_grant' });
      const refresh = token('refresh');
      const access = token('access');
      state.refresh.set(refresh, { revoked: false });
      state.access.set(access, Date.now() + ACCESS_TTL_S * 1000);
      record(call, 200);
      return send(res, 200, { access_token: access, refresh_token: refresh, expires_in: ACCESS_TTL_S, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/calendar.events' });
    }
    if (f.grant_type === 'refresh_token') {
      const r = state.refresh.get(f.refresh_token);
      if (state.mode.refresh === 'invalid_grant' || !r || r.revoked) {
        return send(res, record(call, 400), { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      }
      const access = token('access');
      state.access.set(access, Date.now() + ACCESS_TTL_S * 1000);
      record(call, 200);
      return send(res, 200, { access_token: access, expires_in: ACCESS_TTL_S, token_type: 'Bearer' });
    }
    return send(res, record(call, 400), { error: 'unsupported_grant_type' });
  }

  if (path === '/revoke' && req.method === 'POST') {
    const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
    const r = state.refresh.get(f.token);
    if (r) r.revoked = true;
    state.access.delete(f.token);
    state.revoked.push(f.token);
    return send(res, record({ op: 'revoke', known: !!r }, 200), {});
  }

  // ---- Calendar API ----
  if (path.startsWith('/calendar/v3/')) {
    const unauthorized = { error: { code: 401, message: 'Request had invalid authentication credentials.', status: 'UNAUTHENTICATED' } };
    if (path === '/calendar/v3/users/me/calendarList' && req.method === 'GET') {
      const call = { op: 'calendarList' };
      if (!bearerOk(req)) return send(res, record(call, 401), unauthorized);
      record(call, 200);
      return send(res, 200, { items: CALENDARS.map((c) => ({ ...c, accessRole: 'owner' })) });
    }
    const m = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (m) {
      const calendarId = decodeURIComponent(m[1]);
      const eventId = m[2] ? decodeURIComponent(m[2]) : undefined;
      const op = req.method === 'POST' && !eventId ? 'insert' : req.method === 'PATCH' && eventId ? 'patch' : req.method === 'DELETE' && eventId ? 'delete' : null;
      const body = req.method === 'DELETE' ? null : JSON.parse((await readBody(req)) || 'null');
      const call = { op, calendarId, eventId: eventId ?? body?.id, sendUpdates: url.searchParams.get('sendUpdates') };
      if (!op) return send(res, record(call, 405), { error: { code: 405, message: 'Method not allowed' } });
      if (!bearerOk(req)) return send(res, record(call, 401), unauthorized);
      const cal = state.events.get(calendarId);
      if (!cal) return send(res, record(call, 404), { error: { code: 404, message: 'Not Found' } });
      if (state.mode.events === 'down') return send(res, record(call, 503), { error: { code: 503, message: 'Backend Error', status: 'UNAVAILABLE' } });
      if (op === 'insert') {
        const id = body.id || token('event');
        if (cal.has(id)) return send(res, record(call, 409), { error: { code: 409, message: 'The requested identifier already exists.' } });
        cal.set(id, { ...body, id });
        record(call, 200);
        return send(res, 200, cal.get(id));
      }
      if (!cal.has(eventId)) return send(res, record(call, 404), { error: { code: 404, message: 'Not Found' } });
      if (op === 'patch') {
        cal.set(eventId, { ...cal.get(eventId), ...body, id: eventId });
        record(call, 200);
        return send(res, 200, cal.get(eventId));
      }
      cal.delete(eventId);
      record(call, 204);
      res.writeHead(204);
      return res.end();
    }
  }
  return send(res, 404, 'not found');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => send(res, 500, { error: { code: 500, message: String(err && err.message) } }));
});
server.listen(PORT, '127.0.0.1', () => console.log(`fake Google on http://127.0.0.1:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
