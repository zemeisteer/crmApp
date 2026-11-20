import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from './attempt-limiter';

describe('AttemptLimiter', () => {
  it('shuts an account after max failures for the rest of the window, then opens it again', () => {
    const l = new AttemptLimiter(3, 1000);
    const t0 = 10_000;
    for (let i = 0; i < 2; i++) l.fail('+998901112233', t0 + i);
    expect(l.retryAfter('+998901112233', t0 + 5)).toBe(0);
    l.fail('+998901112233', t0 + 6);
    expect(l.retryAfter('+998901112233', t0 + 10)).toBe(990);
    // Another account is not affected.
    expect(l.retryAfter('+998909998877', t0 + 10)).toBe(0);
    expect(l.retryAfter('+998901112233', t0 + 1000)).toBe(0);
  });

  it('a success clears the count', () => {
    const l = new AttemptLimiter(2, 1000);
    l.fail('a', 0);
    l.succeed('a');
    l.fail('a', 1);
    expect(l.retryAfter('a', 2)).toBe(0);
  });

  it('never grows past its bound', () => {
    const l = new AttemptLimiter(2, 1000, 3);
    for (const k of ['a', 'b', 'c', 'd', 'e']) l.fail(k, 0);
    expect(
      (l as unknown as { rows: Map<string, unknown> }).rows.size,
    ).toBeLessThanOrEqual(3);
  });
});
