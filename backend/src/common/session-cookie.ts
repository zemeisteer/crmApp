import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';

const COOKIE = 'talimcrm_refresh';
// The browser sends it to the session routes only.
const COOKIE_PATH = '/api/auth';
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const TRANSPORT_HEADER = 'x-session-transport';

// A student's or parent's cabinet: one cookie per child signed in (a parent
// may switch between several), sent to the cabinet's routes only. The page
// names the child it means in a header; the token itself stays unreadable.
const PORTAL_PREFIX = 'talimcrm_cab_';
const PORTAL_PATH = '/api/portal';
const PORTAL_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const PORTAL_STUDENT_HEADER = 'x-portal-student';
const STUDENT_ID = /^[A-Za-z0-9_-]{1,64}$/;

const wantsCookie = (req: Request) => req.headers[TRANSPORT_HEADER] === 'cookie';

/**
 * The refresh token from the cookie. Only with the transport header: a custom
 * header needs CORS approval, so another site cannot make a browser use the
 * cookie (the same reason SameSite=Lax is set).
 */
export function refreshTokenFromCookie(req: Request): string | undefined {
  if (!wantsCookie(req)) return undefined;
  return cookies(req).get(COOKIE);
}

function cookies(req: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name && value) out.set(name, value);
  }
  return out;
}

/** The cabinet token of the child the page names, from its cookie (same transport rule as above). */
export function portalTokenFromCookie(req: Request): string | undefined {
  const id = req.headers[PORTAL_STUDENT_HEADER];
  if (!wantsCookie(req) || typeof id !== 'string' || !STUDENT_ID.test(id)) return undefined;
  return cookies(req).get(PORTAL_PREFIX + id);
}

type CabinetSession = { accessToken?: unknown; student?: { id?: unknown } };

/** Each cabinet session in an answer becomes its cookie; the answer keeps the rest. */
function cabinetSessionsToCookies(req: Request, res: Response, body: Record<string, unknown>) {
  const take = (s: CabinetSession) => {
    if (typeof s?.accessToken !== 'string' || typeof s.student?.id !== 'string' || !STUDENT_ID.test(s.student.id)) return s;
    res.cookie(PORTAL_PREFIX + s.student.id, s.accessToken, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: PORTAL_PATH, maxAge: PORTAL_MAX_AGE_MS });
    const { accessToken: _token, ...rest } = s;
    return rest;
  };
  const out: Record<string, unknown> = take(body as CabinetSession) as Record<string, unknown>;
  if (Array.isArray(body.sessions)) out.sessions = body.sessions.map((s) => take(s as CabinetSession));
  return out;
}

/**
 * The site's requests ask for this transport: a refresh token in any answer
 * becomes an httpOnly cookie instead, so a script on the page cannot read it.
 * Other API clients (and the suites) keep getting it in the body.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => {
        if (req.path?.endsWith('/portal/auth/logout')) {
          for (const name of cookies(req).keys()) if (name.startsWith(PORTAL_PREFIX)) res.clearCookie(name, { path: PORTAL_PATH });
          return body;
        }
        if (req.path?.endsWith('/auth/logout')) res.clearCookie(COOKIE, { path: COOKIE_PATH });
        if (wantsCookie(req) && req.path?.includes('/portal/') && body && typeof body === 'object') return cabinetSessionsToCookies(req, res, body as Record<string, unknown>);
        if (!wantsCookie(req) || !body || typeof body !== 'object' || typeof (body as { refreshToken?: unknown }).refreshToken !== 'string') return body;
        const { refreshToken, ...rest } = body as { refreshToken: string };
        res.cookie(COOKIE, refreshToken, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: COOKIE_PATH, maxAge: MAX_AGE_MS });
        return rest;
      }),
    );
  }
}
