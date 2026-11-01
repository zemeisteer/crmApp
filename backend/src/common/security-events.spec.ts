import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALERT_AFTER, recordSignInFailure } from './security-events';

describe('recordSignInFailure', () => {
  afterEach(() => vi.restoreAllMocks());

  it('alerts once, at the limit, and the log holds no e-mail', () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const alerts = Array.from({ length: ALERT_AFTER + 2 }, () => recordSignInFailure('staff', 'victim@test.uz', undefined, 1000));
    expect(alerts.filter(Boolean)).toHaveLength(1);
    expect(alerts[ALERT_AFTER - 1]).toBe(true);
    expect(warn.mock.calls.map((c) => String(c[0])).join()).not.toContain('victim');
  });

  it('counts afresh after five minutes, and many accounts from one address alert too', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < ALERT_AFTER - 1; i++) recordSignInFailure('staff', 'slow@test.uz', undefined, 1000);
    expect(recordSignInFailure('staff', 'slow@test.uz', undefined, 1000 + 5 * 60_000)).toBe(false);
    const spread = Array.from({ length: ALERT_AFTER }, (_, i) => recordSignInFailure('cabinet', `+99890000000${i}`, '10.9.9.9', 2000));
    expect(spread.at(-1)).toBe(true);
  });
});
