import { ConflictException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { makeupCredits } from '../db/schema';
import { zonedParts } from '../common/timezone';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** The calendar day of an instant on the center's own clock (YYYY-MM-DD). */
export function dayIn(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export interface Membership {
  status: string;
  joinedAt: Date;
  leftAt: Date | null;
}

/**
 * What a make-up credit rests on. One rule for the list of who may get a
 * credit (MakeupsService.eligible) and for issuing one (MakeupsService.issue):
 * the list is a convenience, the API call is checked by the same functions.
 *
 * The enrollment row is all that is known about when a student was in a
 * group: one row per student and group, with the day they (last) joined and
 * the day they left. Days are the center's calendar days, not UTC.
 *
 *  - Gone by a date: not active, and left on or before it. Someone who is
 *    not active and has no leaving day recorded counts as gone (nothing
 *    says they were still there).
 *  - A lesson the center called off earns a credit for the students who
 *    were in the group that day: joined on or before it, and not gone.
 *  - An absence earns a credit when the mark is there and the student was
 *    not gone by that day. The joining day is not asked: attendance is only
 *    taken for students enrolled in the group, and a center that entered a
 *    student after they started still records the lessons they missed. The
 *    mark is the evidence.
 *  - A student who left and joined again has the joining day of the last
 *    time only - the earlier stay is not kept. A lesson cancelled during the
 *    earlier stay therefore earns no credit; an absence marked then does.
 */
export function goneBy(e: Membership, date: string, tz: string): boolean {
  if (e.status === 'ACTIVE') return false;
  return e.leftAt === null || dayIn(e.leftAt, tz) <= date;
}

/** In the group on that day, as far as the enrollment row tells. */
export function memberOn(e: Membership | null | undefined, date: string, tz: string): boolean {
  if (!e) return false;
  return dayIn(e.joinedAt, tz) <= date && !goneBy(e, date, tz);
}

/** An ABSENT mark as the basis of a credit. */
export function absenceCounts(mark: unknown, e: Membership | null | undefined, date: string, tz: string): boolean {
  return !!mark && !!e && !goneBy(e, date, tz);
}

/**
 * An attendance mark that is no longer ABSENT takes the ground from under
 * the credit issued for that absence. Called in the transaction that
 * changes the marks, after they are written (so it waits for a credit being
 * issued on the old mark, and then sees it):
 *  - a credit not used yet is voided, with a note saying why;
 *  - a credit already booked into a lesson stops the correction: the
 *    booking has to be cancelled first, on purpose, by someone who sees it;
 *  - a credit already used or forfeited is history and stays.
 */
export async function settleAbsenceCredits(tx: Tx, tenantId: string, groupId: string, date: string, studentIds: string[], userId: string | null): Promise<{ voided: string[] }> {
  if (studentIds.length === 0) return { voided: [] };
  const live = await tx.select({ id: makeupCredits.id, status: makeupCredits.status, studentId: makeupCredits.studentId }).from(makeupCredits)
    .where(and(
      eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.originGroupId, groupId), eq(makeupCredits.originDate, date), eq(makeupCredits.reason, 'ABSENT'),
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
