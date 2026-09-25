import { and, eq, isNull, notInArray, sql, SQL } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { enrollments, students } from '../db/schema';

type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// A seat in a group is held by an ACTIVE enrollment of a student who is still
// with the center. Leaving or graduating does not cancel enrollments, so
// counting enrollments alone made groups look fuller than they are (and
// could refuse new students). PAUSED students keep their seat.
export const SEAT_RELEASING_STUDENT_STATUSES = ['LEFT', 'GRADUATED'];

export function seatHeldWhere(extra?: SQL): SQL {
  return and(
    eq(enrollments.status, 'ACTIVE'),
    isNull(students.deletedAt),
    notInArray(students.status, SEAT_RELEASING_STUDENT_STATUSES),
    ...(extra ? [extra] : []),
  )!;
}

export async function countOccupiedSeats(exec: Executor, groupId: string): Promise<number> {
  const [{ n }] = await exec
    .select({ n: sql<number>`count(*)::int` })
    .from(enrollments)
    .innerJoin(students, eq(students.id, enrollments.studentId))
    .where(seatHeldWhere(eq(enrollments.groupId, groupId)));
  return n;
}
