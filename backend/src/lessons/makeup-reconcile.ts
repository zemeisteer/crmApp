import { and, eq, gte, inArray, ne } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { enrollments, makeupBookings, makeupCredits } from '../db/schema';
import { centerToday } from '../common/center-today';
import { lessonOccurrences } from './occurrences';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface MakeupReconcile {
  /** Bookings that followed their lesson to its new time. */
  moved: number;
  /** Bookings that could not follow: cancelled, and the credit is usable again. */
  released: number;
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd;

/**
 * After the lessons of these groups changed (a timetable row moved, edited,
 * cancelled or deleted; the group form changed its rows; the group was
 * deleted, archived or completed): make-ups booked into those lessons must
 * not keep an old time, room or teacher - and must never end up in another
 * lesson than the one that was chosen.
 *
 * A booking is bound to its lesson by the timetable row (target_schedule_id,
 * see lessons/occurrences.ts). For every booking from today on that is
 * still only booked:
 *  - its row still gives a lesson on that date: the booking stays with it
 *    and takes its time, teacher and room - unless the student is busy at
 *    the new time;
 *  - its row gives no lesson on that date any more (deleted, cancelled,
 *    moved to another day, the group no longer has lessons): the booking is
 *    cancelled and the credit released. It is NOT moved to another lesson of
 *    the group that day, however many there are;
 *  - a booking with no row (a group without timetable rows, or an old
 *    booking that could not be matched): it holds only while exactly one
 *    lesson of the group is on that date at the booked start, and is then
 *    bound to it; otherwise it is released.
 *
 * `gone`: rows about to be deleted in this transaction (the delete itself
 * would only blank target_schedule_id).
 *
 * Past bookings and marked ones are history and are never touched. A
 * release is conditional on the status just read, so a credit comes back
 * exactly once. Runs in the caller's transaction, after lockTimetable.
 */
export async function reconcileGroupMakeups(
  tx: Tx,
  tenantId: string,
  groupIds: Array<string | null | undefined>,
  userId: string | null,
  opts: { gone?: string[]; note?: string } = {},
): Promise<MakeupReconcile> {
  const ids = [...new Set(groupIds.filter(Boolean) as string[])];
  const result: MakeupReconcile = { moved: 0, released: 0 };
  if (ids.length === 0) return result;
  const today = await centerToday(tx, tenantId);
  const bookings = await tx.select().from(makeupBookings)
    .where(and(
      eq(makeupBookings.tenantId, tenantId), inArray(makeupBookings.targetGroupId, ids), eq(makeupBookings.mode, 'GROUP_LESSON'),
      eq(makeupBookings.status, 'BOOKED'), gte(makeupBookings.date, today),
    ))
    .for('update');
  if (bookings.length === 0) return result;

  const gone = new Set(opts.gone ?? []);
  const dates = bookings.map((b) => b.date).sort();
  const lessons = (await lessonOccurrences(tx, tenantId, dates[0], dates[dates.length - 1], ids))
    .filter((l) => !l.cancelled && !(l.scheduleId && gone.has(l.scheduleId)));

  const release = async (b: (typeof bookings)[number]) => {
    const closed = await tx.update(makeupBookings)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: userId, note: opts.note ?? 'LESSON_CHANGED', updatedAt: new Date() })
      .where(and(eq(makeupBookings.id, b.id), eq(makeupBookings.status, 'BOOKED')))
      .returning({ id: makeupBookings.id });
    if (closed.length === 0) return;
    await tx.update(makeupCredits).set({ status: 'ISSUED', updatedAt: new Date() })
      .where(and(eq(makeupCredits.id, b.creditId), eq(makeupCredits.status, 'BOOKED')));
    result.released += 1;
  };

  for (const b of bookings) {
    const sameDay = lessons.filter((l) => l.groupId === b.targetGroupId && l.date === b.date);
    let lesson: (typeof lessons)[number] | null;
    if (b.targetScheduleId) {
      lesson = sameDay.find((l) => l.scheduleId === b.targetScheduleId) ?? null;
    } else {
      const atStart = sameDay.filter((l) => l.startTime === b.startTime);
      lesson = atStart.length === 1 ? atStart[0] : null;
    }
    if (!lesson) {
      await release(b);
      continue;
    }
    const timeChanged = lesson.startTime !== b.startTime || lesson.endTime !== b.endTime;
    if (timeChanged) {
      // Free at the new time? Their other make-ups that day, and their own lessons.
      const others = await tx.select({ startTime: makeupBookings.startTime, endTime: makeupBookings.endTime }).from(makeupBookings)
        .where(and(eq(makeupBookings.studentId, b.studentId), eq(makeupBookings.date, b.date), inArray(makeupBookings.status, ['BOOKED', 'ATTENDED']), ne(makeupBookings.id, b.id)));
      const ownGroups = (await tx.select({ groupId: enrollments.groupId }).from(enrollments)
        .where(and(eq(enrollments.studentId, b.studentId), eq(enrollments.status, 'ACTIVE')))).map((e) => e.groupId);
      const own = (await lessonOccurrences(tx, tenantId, b.date, b.date, ownGroups)).filter((l) => !l.cancelled);
      if ([...others, ...own].some((x) => overlaps(x.startTime, x.endTime, lesson.startTime, lesson.endTime))) {
        await release(b);
        continue;
      }
    }
    const bind = !b.targetScheduleId && lesson.scheduleId ? lesson.scheduleId : null;
    if (timeChanged || bind || lesson.teacherId !== b.teacherId || lesson.roomId !== b.roomId || lesson.branchId !== b.branchId) {
      await tx.update(makeupBookings)
        .set({
          startTime: lesson.startTime, endTime: lesson.endTime, teacherId: lesson.teacherId, roomId: lesson.roomId, branchId: lesson.branchId,
          ...(bind ? { targetScheduleId: bind } : {}), updatedAt: new Date(),
        })
        .where(eq(makeupBookings.id, b.id));
      if (timeChanged) result.moved += 1;
    }
  }
  return result;
}
