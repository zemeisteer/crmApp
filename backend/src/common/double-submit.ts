import { sql } from 'drizzle-orm';

/** How long an identical "create" counts as the same click arriving twice. */
export const DOUBLE_SUBMIT_WINDOW_MS = 10_000;

/**
 * Serializes identical create requests inside a transaction: the second of
 * two that arrive together waits here until the first has committed, and
 * then finds the row the first one made. The key names what "identical"
 * means for the caller (center + the fields a person typed).
 */
export async function lockIdenticalCreate(tx: { execute: (q: any) => Promise<unknown> }, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`create:${key}`}, 0))`);
}

export const doubleSubmitSince = () => new Date(Date.now() - DOUBLE_SUBMIT_WINDOW_MS);
