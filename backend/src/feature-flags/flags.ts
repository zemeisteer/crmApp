import { ServiceUnavailableException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { featureFlags } from '../db/schema';

/**
 * Platform switches (feature_flags): staged rollout, emergency stop, a
 * center's own override. Not the same as what a plan includes
 * (plans/entitlements.ts): a switch is the platform's operational decision,
 * an entitlement a commercial one.
 *
 * Each switch has a default (DEFAULT_ON) until set: globally (tenant_id null)
 * or for one center (its row wins over the global one).
 *   ai         every AI call: staff pages, the students' tutor, AI marking
 *   sms        sending SMS
 *   telegram   Telegram notifications
 *   signups    new centers signing up
 *   telephony  IP telephony for a center whose plan does not include it
 *              (plans/entitlements.ts): OFF until the platform admin turns
 *              it on, for one center or for all
 */
export const FLAGS = ['ai', 'sms', 'telegram', 'signups', 'telephony'] as const;
export type FlagKey = (typeof FLAGS)[number];
export const DEFAULT_ON: Record<FlagKey, boolean> = { ai: true, sms: true, telegram: true, signups: true, telephony: false };

// Read on every request that needs one: kept for a few seconds per center.
const TTL_MS = 5_000;
const cache = new Map<string, { at: number; on: boolean }>();
export const clearFlagCache = () => cache.clear();

export async function flagOn(db: Pick<Database, 'select'>, key: FlagKey, tenantId?: string | null): Promise<boolean> {
  const id = `${key}:${tenantId ?? ''}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.on;
  const rows = await db
    .select({ tenantId: featureFlags.tenantId, enabled: featureFlags.enabled })
    .from(featureFlags)
    .where(and(eq(featureFlags.key, key), tenantId ? or(eq(featureFlags.tenantId, tenantId), isNull(featureFlags.tenantId)) : isNull(featureFlags.tenantId)));
  const own = tenantId ? rows.find((r) => r.tenantId === tenantId) : undefined;
  const global = rows.find((r) => r.tenantId === null);
  const on = (own ?? global)?.enabled ?? DEFAULT_ON[key];
  cache.set(id, { at: Date.now(), on });
  return on;
}

export const signupsPaused = () =>
  new ServiceUnavailableException({ code: 'SIGNUPS_PAUSED', message: "Yangi ro'yxatdan o'tish vaqtincha to'xtatilgan. Birozdan so'ng urinib ko'ring." });
