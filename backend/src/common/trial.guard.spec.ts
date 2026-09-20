import { describe, it, expect, vi } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TrialGuard } from './trial.guard';

function makeContext(method: string, user: any): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method, user }) }),
  } as unknown as ExecutionContext;
}

function makeDb(tenant: any) {
  return { query: { tenants: { findFirst: vi.fn().mockResolvedValue(tenant) } } } as any;
}

describe('TrialGuard', () => {
  it('always allows GET requests, even for a suspended tenant', async () => {
    const guard = new TrialGuard(makeDb({ status: 'SUSPENDED' }));
    const ctx = makeContext('GET', { tenantId: 't1', role: 'ADMIN' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows writes when there is no authenticated tenant user (public routes)', async () => {
    const guard = new TrialGuard(makeDb(null));
    const ctx = makeContext('POST', undefined);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('always allows a SUPERADMIN, regardless of tenant status', async () => {
    const guard = new TrialGuard(makeDb({ status: 'SUSPENDED' }));
    const ctx = makeContext('POST', { tenantId: 't1', role: 'SUPERADMIN' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('blocks writes from a SUSPENDED tenant', async () => {
    const guard = new TrialGuard(makeDb({ status: 'SUSPENDED' }));
    const ctx = makeContext('POST', { tenantId: 't1', role: 'ADMIN' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks writes from a tenant whose trial has lapsed', async () => {
    const guard = new TrialGuard(makeDb({ status: 'TRIAL', trialEndsAt: new Date(Date.now() - 86_400_000) }));
    const ctx = makeContext('POST', { tenantId: 't1', role: 'ADMIN' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows writes from a tenant whose trial is still active', async () => {
    const guard = new TrialGuard(makeDb({ status: 'TRIAL', trialEndsAt: new Date(Date.now() + 86_400_000) }));
    const ctx = makeContext('POST', { tenantId: 't1', role: 'ADMIN' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('allows writes from an ACTIVE tenant', async () => {
    const guard = new TrialGuard(makeDb({ status: 'ACTIVE' }));
    const ctx = makeContext('POST', { tenantId: 't1', role: 'ADMIN' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
