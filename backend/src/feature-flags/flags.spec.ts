import { beforeEach, describe, expect, it } from 'vitest';
import { clearFlagCache, flagOn } from './flags';

// The rule, without a database: a center's own row wins over the global
// one; with neither, the switch is on.
function dbWith(rows: Array<{ tenantId: string | null; enabled: boolean }>) {
  return { select: () => ({ from: () => ({ where: async () => rows }) }) } as never;
}

describe('flagOn', () => {
  beforeEach(() => clearFlagCache());

  it('is on when nobody turned it off', async () => {
    expect(await flagOn(dbWith([]), 'ai', 't1')).toBe(true);
    expect(await flagOn(dbWith([]), 'signups')).toBe(true);
  });

  it('follows the global row', async () => {
    expect(await flagOn(dbWith([{ tenantId: null, enabled: false }]), 'ai', 't1')).toBe(false);
    expect(await flagOn(dbWith([{ tenantId: null, enabled: false }]), 'signups')).toBe(false);
  });

  it("a center's own row wins, both ways", async () => {
    expect(await flagOn(dbWith([{ tenantId: null, enabled: false }, { tenantId: 't1', enabled: true }]), 'ai', 't1')).toBe(true);
    clearFlagCache();
    expect(await flagOn(dbWith([{ tenantId: null, enabled: true }, { tenantId: 't1', enabled: false }]), 'ai', 't1')).toBe(false);
  });

  it('remembers an answer for a few seconds (one read per request burst)', async () => {
    let reads = 0;
    const db = { select: () => ({ from: () => ({ where: async () => { reads++; return []; } }) }) } as never;
    await flagOn(db, 'sms', 't9');
    await flagOn(db, 'sms', 't9');
    expect(reads).toBe(1);
  });
});
