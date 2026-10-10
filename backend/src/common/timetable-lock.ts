import { sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * One writer at a time per center for everything that decides who is where
 * and when: timetable rows, lesson cancellations, make-up bookings.
 *
 * The finer locks (a teacher, a room, a group) cannot see every clash: two
 * lessons for different groups and teachers still share a student, and a
 * lesson called off and a make-up booked into it touch different rows. Taken
 * first in the transaction - before any row lock - so that every check made
 * afterwards reads what the previous writer left, and no two of these
 * transactions ever wait on each other in a circle.
 */
export async function lockTimetable(tx: Tx, tenantId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`timetable:${tenantId}`}))`);
}
