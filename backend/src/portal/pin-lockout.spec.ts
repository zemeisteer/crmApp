import { describe, expect, it } from 'vitest';
import { lockRemainingMs } from './pin-lockout';

const at = (ms: number) => new Date(ms);

describe('lockRemainingMs', () => {
  it('under the limit: open', () => {
    expect(lockRemainingMs([at(1000), at(2000)], 3000, 3, 10_000)).toBe(0);
  });

  it('at the limit: shut until the oldest failure is a window old', () => {
    // 3 failures at t=1000, 2000, 3000; at t=4000 the first ages out at 11_000.
    expect(
      lockRemainingMs([at(1000), at(2000), at(3000)], 4000, 3, 10_000),
    ).toBe(7000);
  });

  it('opens one by one as old failures age out (sliding window)', () => {
    const fails = [1000, 2000, 3000, 4000].map(at);
    // 4 failures, max 3: needs the oldest 2 gone to leave 2 -> open at 12_000.
    expect(lockRemainingMs(fails, 5000, 3, 10_000)).toBe(7000);
    // After the first has aged out (t=11_001) only 3 are left, still shut until 12_000.
    expect(lockRemainingMs(fails, 11_001, 3, 10_000)).toBe(999);
    expect(lockRemainingMs(fails, 12_001, 3, 10_000)).toBe(0);
  });

  it('failures past the window do not count', () => {
    expect(lockRemainingMs([at(0), at(1), at(2)], 50_000, 3, 10_000)).toBe(0);
  });
});
