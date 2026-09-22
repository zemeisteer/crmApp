import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { Permission } from './permissions';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new PermissionsGuard(reflector);
  });

  function createMockContext(user: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access if no permissions are required', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const ctx = createMockContext({ role: 'TEACHER' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ADMIN regardless of required permissions', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.EXPENSES_MANAGE]);
    const ctx = createMockContext({ role: 'ADMIN' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows ACCOUNTANT to manage expenses by default role mapping', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.EXPENSES_MANAGE]);
    const ctx = createMockContext({ role: 'ACCOUNTANT' });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('blocks TEACHER from managing expenses by default', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.EXPENSES_MANAGE]);
    const ctx = createMockContext({ role: 'TEACHER' });
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('allows TEACHER who has custom permission override', () => {
    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue([Permission.EXPENSES_MANAGE]);
    const ctx = createMockContext({
      role: 'TEACHER',
      permissions: [Permission.EXPENSES_MANAGE],
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
