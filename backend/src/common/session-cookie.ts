import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map } from 'rxjs';

const COOKIE = 'talimcrm_refresh';
// The browser sends it to the session routes only.
const COOKIE_PATH = '/api/auth';
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;
const TRANSPORT_HEADER = 'x-session-transport';

const wantsCookie = (req: Request) => req.headers[TRANSPORT_HEADER] === 'cookie';

/**
 * The refresh token from the cookie. Only with the transport header: a custom
 * header needs CORS approval, so another site cannot make a browser use the
 * cookie (the same reason SameSite=Lax is set).
 */
export function refreshTokenFromCookie(req: Request): string | undefined {
  if (!wantsCookie(req)) return undefined;
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE && value) return value;
  }
  return undefined;
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
        if (req.path?.endsWith('/auth/logout')) res.clearCookie(COOKIE, { path: COOKIE_PATH });
        if (!wantsCookie(req) || !body || typeof body !== 'object' || typeof (body as { refreshToken?: unknown }).refreshToken !== 'string') return body;
        const { refreshToken, ...rest } = body as { refreshToken: string };
        res.cookie(COOKIE, refreshToken, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: COOKIE_PATH, maxAge: MAX_AGE_MS });
        return rest;
      }),
    );
  }
}
