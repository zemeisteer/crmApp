import { describe, expect, it } from 'vitest';
import { lastValueFrom, of } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';
import { SessionCookieInterceptor } from './session-cookie';

function run(path: string, body: unknown, headers: Record<string, string> = { 'x-session-transport': 'cookie' }) {
  const cookies: Array<{ name: string; value: string; path?: string }> = [];
  const req = { path, headers, secure: false };
  const res = { cookie: (name: string, value: string, o: { path?: string }) => cookies.push({ name, value, path: o.path }), clearCookie: () => undefined };
  const ctx = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as unknown as ExecutionContext;
  return lastValueFrom(new SessionCookieInterceptor().intercept(ctx, { handle: () => of(body) })).then((out) => ({ out, cookies }));
}

describe('cabinet sessions in an answer', () => {
  it('a list of children (siblings, a parent): one cookie each, no token left in the answer', async () => {
    const body = { choose: [{ id: 'a' }, { id: 'b' }], sessions: [{ accessToken: 'ta', student: { id: 'a' } }, { accessToken: 'tb', student: { id: 'b' } }] };
    const { out, cookies } = await run('/api/portal/auth/phone/verify', body);
    expect(cookies).toEqual([
      { name: 'talimcrm_cab_a', value: 'ta', path: '/api/portal' },
      { name: 'talimcrm_cab_b', value: 'tb', path: '/api/portal' },
    ]);
    expect(JSON.stringify(out)).not.toMatch(/"accessToken"/);
    expect((out as { choose: unknown[] }).choose).toHaveLength(2);
  });

  it('without the transport header the answer is unchanged', async () => {
    const body = { sessions: [{ accessToken: 'ta', student: { id: 'a' } }] };
    const { out, cookies } = await run('/api/portal/auth/parent-account', body, {});
    expect(cookies).toEqual([]);
    expect(out).toEqual(body);
  });

  it('an id that is not a plain id makes no cookie', async () => {
    const { cookies } = await run('/api/portal/auth/token', { accessToken: 't', student: { id: 'a;b=c' } });
    expect(cookies).toEqual([]);
  });
});
