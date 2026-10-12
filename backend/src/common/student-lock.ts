import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * One writer at a time per student for what decides whether a lesson is
 * theirs: the student's status (active, paused, left, graduated, removed),
 * their enrollments and stays in groups - and the attendance marks that
 * are checked against those.
 *
 * Without it a mark could be validated against a membership that ends a
 * moment later, and two status changes could each decide from the status
 * the other was about to replace.
 *
 * Order, so that no two transactions wait on each other in a circle: the
 * center's timetable lock first (common/timetable-lock.ts) when the
 * transaction takes it at all, then students in id order, then row locks
 * (a group row, a credit).
 */
export async function lockStudents(tx: Tx, tenantId: string, studentIds: string[]): Promise<void> {
  for (const id of [...new Set(studentIds)].sort()) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`student:${tenantId}:${id}`}))`);
  }
}
