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
 * cancelled or deleted, or the group form rebuilt its rows): make-ups booked
 * into those lessons must not keep the old time, room or teacher.
 *
 * The rule, for every booking from today on that is still only booked:
 *  - the lesson is still on that date at the same start: the booking stays,
 *    and takes the lesson's teacher and room;
 *  - the group has exactly one lesson that date, at another time: the
 *    booking follows it - unless the student is busy then;
 *  - otherwise (no lesson that date any more, the student is busy at the new
 *    time, or it is not clear which of several lessons was meant): the
 *    booking is cancelled and its credit is released, to be booked again.
 *
 * Past bookings and marked ones are history and are never touched. Runs in
 * the caller's transaction, after lockTimetable.
 */
export async function reconcileGroupMakeups(tx: Tx, tenantId: string, groupIds: Array<string | null | undefined>, userId: string | null): Promise<MakeupReconcile> {
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

  const dates = bookings.map((b) => b.date).sort();
  const lessons = (await lessonOccurrences(tx, tenantId, dates[0], dates[dates.length - 1], ids)).filter((l) => !l.cancelled);

  const release = async (b: (typeof bookings)[number]) => {
    await tx.update(makeupBookings)
      .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: userId, note: 'LESSON_CHANGED', updatedAt: new Date() })
      .where(and(eq(makeupBookings.id, b.id), eq(makeupBookings.status, 'BOOKED')));
    await tx.update(makeupCredits).set({ status: 'ISSUED', updatedAt: new Date() })
      .where(and(eq(makeupCredits.id, b.creditId), eq(makeupCredits.status, 'BOOKED')));
    result.released += 1;
  };

  for (const b of bookings) {
    const sameDay = lessons.filter((l) => l.groupId === b.targetGroupId && l.date === b.date);
    const lesson = sameDay.find((l) => l.startTime === b.startTime) ?? (sameDay.length === 1 ? sameDay[0] : null);
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
    if (timeChanged || lesson.teacherId !== b.teacherId || lesson.roomId !== b.roomId || lesson.branchId !== b.branchId) {
      await tx.update(makeupBookings)
        .set({ startTime: lesson.startTime, endTime: lesson.endTime, teacherId: lesson.teacherId, roomId: lesson.roomId, branchId: lesson.branchId, updatedAt: new Date() })
        .where(eq(makeupBookings.id, b.id));
      if (timeChanged) result.moved += 1;
    }
  }
  return result;
}
