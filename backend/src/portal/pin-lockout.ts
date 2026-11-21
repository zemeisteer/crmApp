import { createHmac } from 'crypto';
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { portalPinFailures } from '../db/schema';

// A cabinet PIN is 6 digits, so wrong guesses are counted per phone (not only
// per address): MAX wrong PINs within WINDOW_MS shut that phone's PIN sign-in
// until the oldest of them is WINDOW_MS old. The count is in the database
// (portal_pin_failures), so every API instance sees the same one and a
// restart does not clear it. The phone is kept as an HMAC, never as the number.
export const PIN_MAX_FAILURES = 10;
export const PIN_WINDOW_MS = 15 * 60_000;

const phoneHash = (phone: string, secret: string) =>
  createHmac('sha256', secret).update(phone).digest('hex');

/** Milliseconds until the phone may try again, from the times of its recent failures (0: it may now). */
export function lockRemainingMs(
  failedAt: Date[],
  now = Date.now(),
  max = PIN_MAX_FAILURES,
  windowMs = PIN_WINDOW_MS,
): number {
  const live = failedAt
    .map((d) => d.getTime())
    .filter((t) => now - t < windowMs)
    .sort((a, b) => a - b);
  if (live.length < max) return 0;
  // Open again once enough of the oldest have aged out to leave max - 1.
  return live[live.length - max] + windowMs - now;
}

export async function pinLockRemainingMs(
  db: Database,
  phone: string,
  secret: string,
  now = Date.now(),
): Promise<number> {
  const rows = await db
    .select({ at: portalPinFailures.createdAt })
    .from(portalPinFailures)
    .where(
      and(
        eq(portalPinFailures.phoneHash, phoneHash(phone, secret)),
        gt(portalPinFailures.createdAt, new Date(now - PIN_WINDOW_MS)),
      ),
    )
    .orderBy(asc(portalPinFailures.createdAt));
  return lockRemainingMs(
    rows.map((r) => r.at),
    now,
  );
}

export async function recordPinFailure(
  db: Database,
  phone: string,
  secret: string,
  now = Date.now(),
) {
  await db
    .insert(portalPinFailures)
    .values({ phoneHash: phoneHash(phone, secret), createdAt: new Date(now) });
  // Rows past the window count for nothing: whoever fails next clears them
  // (only the last 15 minutes of failures ever sit in this table).
  await db
    .delete(portalPinFailures)
    .where(lt(portalPinFailures.createdAt, new Date(now - PIN_WINDOW_MS)));
}

/** A right PIN clears the phone's failures. */
export async function clearPinFailures(
  db: Database,
  phone: string,
  secret: string,
) {
  await db
    .delete(portalPinFailures)
    .where(eq(portalPinFailures.phoneHash, phoneHash(phone, secret)));
}
