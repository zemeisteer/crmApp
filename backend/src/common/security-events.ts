import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { createHash } from 'crypto';

const logger = new Logger('Security');
export const ALERT_AFTER = 10;
const WINDOW_MS = 5 * 60_000;
const MAX_TRACKED = 10_000;
const counts = new Map<string, { n: number; since: number }>();

function count(key: string, now: number) {
  if (counts.size >= MAX_TRACKED) counts.clear();
  const seen = counts.get(key);
  const row = seen && now - seen.since < WINDOW_MS ? seen : { n: 0, since: now };
  row.n++;
  counts.set(key, row);
  return row.n;
}

/**
 * A wrong password, PIN or code: one log line (the account as a hash, so the
 * log holds no e-mail or phone; the same account always gives the same hash),
 * and an alert once an account or an address reaches ALERT_AFTER within five
 * minutes. Counted per server process. Returns whether this one raised an alert.
 */
export function recordSignInFailure(kind: 'staff' | 'cabinet', account: string, ip?: string, now = Date.now()) {
  const accountHash = createHash('sha256').update(account.trim().toLowerCase()).digest('hex').slice(0, 16);
  logger.warn(JSON.stringify({ event: 'sign_in_failed', kind, account: accountHash, ip: ip ?? null }));
  const reached = [`account:${accountHash}`, ...(ip ? [`ip:${ip}`] : [])].filter((key) => count(key, now) === ALERT_AFTER);
  for (const key of reached) {
    const subject = key.split(':')[0];
    logger.error(JSON.stringify({ event: 'sign_in_failures_alert', kind, subject, account: accountHash, ip: ip ?? null }));
    Sentry.captureMessage(`${ALERT_AFTER} failed sign-ins for one ${subject} in 5 minutes`, 'warning');
  }
  return reached.length > 0;
}
