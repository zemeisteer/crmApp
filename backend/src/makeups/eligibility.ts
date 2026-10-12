import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { makeupCredits } from '../db/schema';
import { lessonInstant, wasMember, type Stay } from '../enrollments/membership';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * What a make-up credit rests on. One rule for the list of who may get a
 * credit (MakeupsService.eligible) and for issuing one (MakeupsService.issue):
 * the list is a convenience, the API call is checked by the same functions.
 *
 * Whether the student was in the group is asked of the membership history
 * (enrollments/membership.ts) - at the lesson's start when it is known,
 * else for the day:
 *  - a lesson the center called off earns a credit for those in the group
 *    then (strict: inside a stay);
 *  - an absence earns a credit when the mark is there and the lesson was
 *    the student's (lenient: inside a stay, or before the first stay that
 *    is known - a center that entered a student after they started still
 *    records the lessons they missed). A lesson in a break between two
 *    stays, or after the student left, is not theirs: no credit.
 */
export function cancelledLessonCounts(stays: Stay[], lesson: { date: string; startTime?: string | null }, tz: string): boolean {
  return wasMember(stays, { date: lesson.date, at: lessonInstant(lesson.date, lesson.startTime, tz) }, tz, 'strict');
}

/** An ABSENT mark as the basis of a credit. */
export function absenceCounts(mark: unknown, stays: Stay[], lesson: { date: string; startTime?: string | null }, tz: string): boolean {
  return !!mark && wasMember(stays, { date: lesson.date, at: lessonInstant(lesson.date, lesson.startTime, tz) }, tz, 'lenient');
}

/**
 * An attendance mark that is no longer ABSENT takes the ground from under
 * the credit issued for that absence - the absence of that lesson
 * (`scheduleId`; null: the day-level mark). Called in the transaction that
 * changes the marks, after they are written (so it waits for a credit being
 * issued on the old mark, and then sees it):
 *  - a credit not used yet is voided, with a note saying why;
 *  - a credit already booked into a lesson stops the correction: the
 *    booking has to be cancelled first, on purpose, by someone who sees it;
 *  - a credit already used or forfeited is history and stays.
 */
export async function settleAbsenceCredits(tx: Tx, tenantId: string, groupId: string, date: string, studentIds: string[], userId: string | null, scheduleId: string | null = null): Promise<{ voided: string[] }> {
  if (studentIds.length === 0) return { voided: [] };
  const live = await tx.select({ id: makeupCredits.id, status: makeupCredits.status, studentId: makeupCredits.studentId }).from(makeupCredits)
    .where(and(
      eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.originGroupId, groupId), eq(makeupCredits.originDate, date), eq(makeupCredits.reason, 'ABSENT'),
      // The credit of this lesson's absence - not of the group's other lesson that day.
      scheduleId ? eq(makeupCredits.originScheduleId, scheduleId) : isNull(makeupCredits.originScheduleId),
      inArray(makeupCredits.studentId, studentIds), inArray(makeupCredits.status, ['ISSUED', 'BOOKED']),
    ))
    .for('update');
  const booked = live.filter((c) => c.status === 'BOOKED');
  if (booked.length) {
    throw new ConflictException({
      code: 'CREDIT_BOOKED',
      message: "Bu yo'qlama uchun berilgan qoplash krediti darsga yozilgan: avval qoplash darsini bekor qiling",
      studentIds: booked.map((c) => c.studentId),
    });
  }
  if (live.length === 0) return { voided: [] };
  const voided = await tx.update(makeupCredits)
    .set({ status: 'CANCELLED', closedAt: new Date(), closedByUserId: userId, note: 'ATTENDANCE_CORRECTED', updatedAt: new Date() })
    .where(and(inArray(makeupCredits.id, live.map((c) => c.id)), eq(makeupCredits.status, 'ISSUED')))
    .returning({ id: makeupCredits.id });
  return { voided: voided.map((v) => v.id) };
}
