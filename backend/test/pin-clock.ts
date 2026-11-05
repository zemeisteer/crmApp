import { afterAll, beforeAll, vi } from 'vitest';

/**
 * These suites ask "which lesson is on now?", so their answer used to depend
 * on when they ran: late in the evening they failed. The clock of the app and
 * of the suite stands at 09:00 Tashkent today, and keeps ticking. Only Date
 * moves: timers stay real. (Call at the top of the describe.)
 */
export function pinClockToMorning() {
  beforeAll(() => {
    const today = new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${today}T04:00:00.000Z`), shouldAdvanceTime: true });
  });
  afterAll(() => {
    vi.useRealTimers();
  });
}
