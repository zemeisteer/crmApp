import { eq } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { tenants } from '../db/schema';
import { DEFAULT_TIMEZONE, zonedParts } from './timezone';

/** Today's date (YYYY-MM-DD) on the center's own clock. */
export async function centerToday(db: Pick<Database, 'select'>, tenantId: string, now: Date = new Date()): Promise<string> {
  const [t] = await db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
  const p = zonedParts(now, t?.tz || DEFAULT_TIMEZONE);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
