import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function makeContext(role: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request when no @Roles() metadata is set on the route', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext('TEACHER'))).toBe(true);
  });

  it("allows the request when the user's role is in the required list", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['ADMIN', 'ACCOUNTANT']) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext('ACCOUNTANT'))).toBe(true);
  });

  it("denies the request when the user's role is not in the required list", () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['ADMIN']) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext('TEACHER'))).toBe(false);
  });

  it('denies an unauthenticated request against a role-restricted route', () => {
    const reflector = { getAllAndOverride: vi.fn().mockReturnValue(['ADMIN']) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeContext(undefined))).toBe(false);
  });
});
