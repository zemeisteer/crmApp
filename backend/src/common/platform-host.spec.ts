import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { centerLabelOf, fromCenterHost } from './platform-host';
import { RolesGuard } from './roles.guard';

describe('platform routes answer on the main domain only', () => {
  it('knows a center address from the main site and reserved names', () => {
    expect(centerLabelOf('alpha.crmapp.com', 'crmapp.com')).toBe('alpha');
    expect(centerLabelOf('Alpha.localhost:3100', 'crmapp.com')).toBe('alpha');
    for (const h of ['crmapp.com', 'www.crmapp.com', 'api.crmapp.com', 'localhost:4100', '127.0.0.1:4000', 'a.b.crmapp.com', 'academy.uz', '', null]) {
      expect(centerLabelOf(h, 'crmapp.com')).toBeNull();
    }
  });

  it('looks at the Origin, the forwarded host and the host', () => {
    expect(fromCenterHost({ host: 'localhost:4100', origin: 'http://alpha.localhost:3100' }, 'crmapp.com')).toBe(true);
    expect(fromCenterHost({ host: 'alpha.crmapp.com' }, 'crmapp.com')).toBe(true);
    expect(fromCenterHost({ host: 'backend:4000', 'x-forwarded-host': 'alpha.crmapp.com' }, 'crmapp.com')).toBe(true);
    expect(fromCenterHost({ host: 'crmapp.com', origin: 'https://crmapp.com' }, 'crmapp.com')).toBe(false);
    expect(fromCenterHost({ host: 'localhost:4100', origin: 'http://localhost:3100' }, 'crmapp.com')).toBe(false);
    expect(fromCenterHost({ host: '127.0.0.1:4000' }, '')).toBe(false);
  });

  const ctx = (headers: Record<string, string>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: { role: 'SUPERADMIN', mfa: true }, headers }) }),
      getHandler: () => ({}),
      getClass: () => ({}),
    }) as unknown as ExecutionContext;
  const guard = (roles: string[]) => new RolesGuard({ getAllAndOverride: vi.fn().mockReturnValue(roles) } as unknown as Reflector);

  it('a SUPERADMIN-only route refuses a center address, even to the superadmin', () => {
    expect(() => guard(['SUPERADMIN']).canActivate(ctx({ host: 'localhost:4100', origin: 'http://alpha.localhost:3100' }))).toThrow(ForbiddenException);
    expect(guard(['SUPERADMIN']).canActivate(ctx({ host: 'localhost:4100', origin: 'http://localhost:3100' }))).toBe(true);
  });

  it('center routes are not affected', () => {
    expect(guard(['ADMIN', 'SUPERADMIN']).canActivate(ctx({ host: 'alpha.crmapp.com' }))).toBe(true);
  });
});
