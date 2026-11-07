import { Client } from 'pg';

/**
 * A trial is marked (came / missed) only once it has begun. Tests book
 * trials ahead, as people do; this moves one's start a minute into the past,
 * as time would.
 */
export async function trialStarted(trialId: string) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(`UPDATE lead_trials SET scheduled_at = (now() AT TIME ZONE 'UTC') - interval '1 minute' WHERE id = $1`, [trialId]);
  } finally {
    await c.end();
  }
}
