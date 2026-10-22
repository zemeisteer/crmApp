import { ForbiddenException } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { invitations, organizationMemberships, students, tenants, trialAiUsage } from '../db/schema';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { trialRules } from './trial-rules';

type Exec = Pick<Database, 'select' | 'execute'>;

const limitReached = (message: string) =>
  new ForbiddenException({ code: 'TRIAL_LIMIT', message: `${message} Davom etish uchun tarifni faollashtiring.` });

async function onTrial(db: Exec, tenantId: string): Promise<boolean> {
  const [t] = await db.select({ status: tenants.status }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.status === 'TRIAL';
}

/**
 * Refuses to add `adding` more students or staff accounts to a center on
 * its free trial beyond the trial's limit (trial-rules.ts). Called inside
 * the transaction that adds them, where one is open: the per-center lock
 * keeps two requests at once from both slipping under the limit.
 * `countPending: false` when an invitation is being accepted: the others
 * still waiting do not stand in its way, the members it joins do.
 */
export async function assertTrialRoom(db: Exec, tenantId: string, kind: 'students' | 'staff', adding = 1, inTransaction = false, opts: { countPending?: boolean } = {}): Promise<void> {
  const rules = trialRules();
  if (!rules.limits || adding <= 0) return;
  if (!(await onTrial(db, tenantId))) return;
  if (inTransaction) await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial-room:${tenantId}:${kind}`}))`);

  if (kind === 'students') {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(students)
      .where(and(eq(students.tenantId, tenantId), isNull(students.deletedAt)));
    if (n + adding > rules.maxStudents) throw limitReached(`Sinov davrida ${rules.maxStudents} tagacha o'quvchi qo'shish mumkin.`);
    return;
  }

  const [{ members }] = await db
    .select({ members: sql<number>`count(*)::int` })
    .from(organizationMemberships)
    .where(and(eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.status, 'ACTIVE'), ne(organizationMemberships.role, 'OWNER')));
  const [{ pending }] = opts.countPending === false ? [{ pending: 0 }] : await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(invitations)
    .where(and(eq(invitations.tenantId, tenantId), eq(invitations.status, 'PENDING'), gt(invitations.expiresAt, new Date())));
  if (members + pending + adding > rules.maxStaff) throw limitReached(`Sinov davrida ${rules.maxStaff} tagacha xodim qo'shish mumkin.`);
}

/** Bulk import (spreadsheets) is not part of the free trial. */
export async function assertNotTrialImport(db: Exec, tenantId: string): Promise<void> {
  if (!trialRules().limits) return;
  if (await onTrial(db, tenantId)) {
    throw limitReached("Sinov davrida fayldan ommaviy import yo'q: o'quvchilarni bittadan qo'shing.");
  }
}

/**
 * Takes one of a center's AI requests for today (its time zone): false once
 * TRIAL_AI_PER_DAY are used. Call it for a center on a running trial; one
 * counter for every door to the AI - staff pages (TrialInterceptor,
 * @UsesAi) and the students' tutor in the cabinet and the Telegram bot.
 * One statement: the counter only rises below the limit, so requests at
 * once cannot pass it. With TRIAL_LIMITS off nothing is counted.
 */
export async function chargeTrialAi(db: Pick<Database, 'insert'>, tenantId: string, timezone?: string | null): Promise<boolean> {
  const rules = trialRules();
  if (!rules.limits) return true;
  const p = zonedParts(new Date(), isValidTimeZone(timezone) ? timezone! : DEFAULT_TIMEZONE);
  const day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  const rows = await db
    .insert(trialAiUsage)
    .values({ tenantId, day, count: 1 })
    .onConflictDoUpdate({
      target: [trialAiUsage.tenantId, trialAiUsage.day],
      set: { count: sql`${trialAiUsage.count} + 1` },
      setWhere: sql`${trialAiUsage.count} < ${rules.aiPerDay}`,
    })
    .returning({ count: trialAiUsage.count });
  return rows.length > 0 && rows[0].count <= rules.aiPerDay;
}
