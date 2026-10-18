import { ForbiddenException } from '@nestjs/common';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { invitations, organizationMemberships, students, tenants } from '../db/schema';
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
 */
export async function assertTrialRoom(db: Exec, tenantId: string, kind: 'students' | 'staff', adding = 1, inTransaction = false): Promise<void> {
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
  const [{ pending }] = await db
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
