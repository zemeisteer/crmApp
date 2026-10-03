import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { sql } from 'drizzle-orm';

/**
 * Retry protection for "create" forms (students, teachers), the same
 * pattern payments use: the client sends an Idempotency-Key with a
 * submission; the server stores the key and a hash of the request on the
 * created row.
 *
 * - same key, same request  -> the row made the first time (no second row,
 *   no second enrollment, audit entry or webhook)
 * - same key, other request -> 409 Conflict
 * - no key                  -> an ordinary create (older clients, scripts)
 *
 * Keys are scoped by center and by operation (they live on the students or
 * the teachers table, per tenant), so they never collide across centers or
 * between a student and a teacher form. This is retry protection only: two
 * different submissions for people with the same name or phone are two
 * records - deciding that they are one person is a business rule, not this.
 */

/** The key from the Idempotency-Key header, validated; null when absent. */
export function idempotencyKey(raw: string | undefined | null): string | null {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) return null;
  if (key.length < 8 || key.length > 120) throw new BadRequestException("Idempotency-Key 8-120 belgidan iborat bo'lishi kerak");
  return key;
}

/**
 * Normalization before hashing - what counts as "the same request":
 * - strings are trimmed; an empty string, null and an omitted field are the
 *   same thing (no value) and are left out of the hash;
 * - arrays (group selections) are compared as sets: trimmed, empty entries
 *   dropped, duplicates removed, sorted;
 * - numbers and booleans as they are; nested objects key by key.
 * Field order never matters (keys are sorted).
 */
export function normalizeForHash(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const v = value.trim();
    return v === '' ? undefined : v;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => normalizeForHash(v)).filter((v) => v !== undefined).map((v) => JSON.stringify(v));
    const set = [...new Set(items)].sort();
    return set.length ? set.map((v) => JSON.parse(v) as unknown) : undefined;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = normalizeForHash((value as Record<string, unknown>)[k]);
      if (v !== undefined) out[k] = v;
    }
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

export function requestHash(operation: string, payload: unknown): string {
  return createHash('sha256').update(JSON.stringify([operation, normalizeForHash(payload) ?? null])).digest('hex');
}

/**
 * Inside the create transaction, before looking the key up: a second
 * request with the same key waits here until the first one commits or
 * rolls back, then finds its row (or, after a rollback, creates its own).
 */
export async function lockIdempotencyKey(tx: { execute: (q: any) => Promise<unknown> }, operation: string, tenantId: string, key: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`idem:${operation}:${tenantId}:${key}`}, 0))`);
}

/** A stored value with no content is stored as no value. */
export const blankToNull = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null);
