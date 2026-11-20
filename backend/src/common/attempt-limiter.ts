// Wrong guesses against one account (a phone's cabinet PIN): after `max`
// failures within `windowMs` the account is shut for the rest of the window,
// however many addresses the guesses come from. The per-address rate limit
// alone lets a guesser with many addresses walk a 6-digit PIN space.
//
// Kept in this process's memory: one server instance counts its own. That
// bounds a guesser well enough for a 6-digit PIN on the deployment this app
// runs (one API instance); several instances each allow `max`.
export class AttemptLimiter {
  private readonly rows = new Map<string, { n: number; since: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60_000,
    private readonly maxTracked = 50_000,
  ) {}

  /** Milliseconds until `key` may try again, or 0 when it may now. */
  retryAfter(key: string, now = Date.now()): number {
    const row = this.rows.get(key);
    if (!row) return 0;
    if (now - row.since >= this.windowMs) {
      this.rows.delete(key);
      return 0;
    }
    return row.n >= this.max ? this.windowMs - (now - row.since) : 0;
  }

  fail(key: string, now = Date.now()) {
    if (this.rows.size >= this.maxTracked) this.sweep(now);
    const row = this.rows.get(key);
    if (!row || now - row.since >= this.windowMs)
      this.rows.set(key, { n: 1, since: now });
    else row.n++;
  }

  succeed(key: string) {
    this.rows.delete(key);
  }

  private sweep(now: number) {
    for (const [k, r] of this.rows)
      if (now - r.since >= this.windowMs) this.rows.delete(k);
    // Still full of live rows: start over rather than grow without bound.
    if (this.rows.size >= this.maxTracked) this.rows.clear();
  }
}
