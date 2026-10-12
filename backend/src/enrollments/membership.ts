import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { enrollmentPeriods, enrollments, groups } from '../db/schema';
import { zonedParts, zonedTimeToUtc } from '../common/timezone';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Reader = Pick<Database, 'select'>;

/**
 * Who was in a group, and when. THE one place that answers it: make-up
 * eligibility, the attendance list of a past lesson, what a student's
 * calendar and cabinet show - all ask here, so they agree.
 *
 * The facts are the stays in enrollment_periods (see schema.ts): one row
 * per stay, [started_at, ended_at) - the start belongs to the stay, the end
 * does not. A stay is open while the student attends the group; leaving the
 * group, a pause, leaving the center, graduating and removal each close it,
 * and coming back opens a new one.
 *
 * Two questions, and their boundaries:
 *  - at an instant (a lesson whose start is known): started_at <= t < ended_at.
 *    A student who joins at 10:00 was not in the 09:00 lesson of that day; one
 *    who leaves at 10:00 was in it, and is not in the 15:00 one.
 *  - on a day (only the date is known): the stay touches that day on the
 *    center's own calendar - the joining day and the leaving day both count.
 *
 * Two strengths:
 *  - strict: inside a stay. Used where the center decides for the student:
 *    a lesson the center called off earns a credit only for those in the
 *    group then.
 *  - lenient: inside a stay, or BEFORE the first stay that is known. A
 *    center often enters a student after they started, and then records the
 *    lessons they attended or missed; nothing says they were not there.
 *    Never in a gap between two stays and never after the last one ended:
 *    those are known.
 */
export interface Stay {
  studentId: string;
  groupId: string;
  startedAt: Date;
  endedAt: Date | null;
  endReason?: string | null;
  source?: string;
}

/** The calendar day of an instant on the center's own clock (YYYY-MM-DD). */
export function dayIn(at: Date, tz: string): string {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The instant a lesson starts (center-local date and HH:MM); null when the time is not known. */
export function lessonInstant(date: string, startTime: string | null | undefined, tz: string): Date | null {
  if (!startTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, Number(startTime.slice(0, 2)), Number(startTime.slice(3, 5)), tz);
}

export function memberAt(stays: Stay[], at: Date): boolean {
  const t = at.getTime();
  return stays.some((s) => s.startedAt.getTime() <= t && (s.endedAt === null || t < s.endedAt.getTime()));
}

export function memberOnDay(stays: Stay[], date: string, tz: string): boolean {
  return stays.some((s) => dayIn(s.startedAt, tz) <= date && (s.endedAt === null || date <= dayIn(s.endedAt, tz)));
}

/**
 * Was the lesson (or the day) the student's? `stays`: that student's stays
 * in that group. `at`: the lesson's start when known, else the date alone
 * decides.
 */
export function wasMember(stays: Stay[], when: { date: string; at?: Date | null }, tz: string, mode: 'strict' | 'lenient'): boolean {
  if (stays.length === 0) return false;
  const inside = when.at ? memberAt(stays, when.at) : memberOnDay(stays, when.date, tz);
  if (inside || mode === 'strict') return inside;
  const first = stays.reduce((a, b) => (a.startedAt.getTime() <= b.startedAt.getTime() ? a : b));
  return when.at ? when.at.getTime() < first.startedAt.getTime() : when.date < dayIn(first.startedAt, tz);
}

/** Stays of these students and/or groups, oldest first. */
export async function staysOf(db: Reader, tenantId: string, by: { studentIds?: string[]; groupIds?: string[] }): Promise<Stay[]> {
  if ((by.studentIds && by.studentIds.length === 0) || (by.groupIds && by.groupIds.length === 0)) return [];
  return db.select({
    studentId: enrollmentPeriods.studentId, groupId: enrollmentPeriods.groupId, startedAt: enrollmentPeriods.startedAt,
    endedAt: enrollmentPeriods.endedAt, endReason: enrollmentPeriods.endReason, source: enrollmentPeriods.source,
  }).from(enrollmentPeriods)
    .where(and(
      eq(enrollmentPeriods.tenantId, tenantId),
      by.studentIds ? inArray(enrollmentPeriods.studentId, by.studentIds) : undefined,
      by.groupIds ? inArray(enrollmentPeriods.groupId, by.groupIds) : undefined,
    ))
    .orderBy(enrollmentPeriods.startedAt);
}

/** Stays keyed by student and group. */
export function staysByMember(stays: Stay[]): Map<string, Stay[]> {
  const map = new Map<string, Stay[]>();
  for (const s of stays) {
    const key = `${s.studentId}|${s.groupId}`;
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return map;
}

// ---- writing (always in the transaction that changes the enrollment or the student) ----

/** A stay begins - unless one is already open (the partial unique index decides, also under a race). */
export async function openStay(tx: Tx, p: { tenantId: string; studentId: string; groupId: string; enrollmentId?: string | null; at?: Date }) {
  await tx.insert(enrollmentPeriods)
    .values({ tenantId: p.tenantId, studentId: p.studentId, groupId: p.groupId, enrollmentId: p.enrollmentId ?? null, startedAt: p.at ?? new Date(), source: 'RECORDED' })
    .onConflictDoNothing({ target: [enrollmentPeriods.studentId, enrollmentPeriods.groupId], where: sql`ended_at IS NULL` });
}

/** The open stay(s) end: of one group, or of every group of the student. An old stay is never rewritten. */
export async function closeStays(tx: Tx, p: { tenantId: string; studentId: string; groupId?: string; reason: string; at?: Date }) {
  await tx.update(enrollmentPeriods)
    .set({ endedAt: p.at ?? new Date(), endReason: p.reason })
    .where(and(
      eq(enrollmentPeriods.tenantId, p.tenantId), eq(enrollmentPeriods.studentId, p.studentId), isNull(enrollmentPeriods.endedAt),
      p.groupId ? eq(enrollmentPeriods.groupId, p.groupId) : undefined,
    ));
}

/** The student attends again: a new stay in every group they are still enrolled in. */
export async function reopenStays(tx: Tx, p: { tenantId: string; studentId: string; at?: Date }) {
  const active = await tx.select({ id: enrollments.id, groupId: enrollments.groupId }).from(enrollments)
    .innerJoin(groups, eq(groups.id, enrollments.groupId))
    .where(and(eq(enrollments.studentId, p.studentId), eq(enrollments.status, 'ACTIVE'), eq(groups.tenantId, p.tenantId)));
  for (const e of active) await openStay(tx, { tenantId: p.tenantId, studentId: p.studentId, groupId: e.groupId, enrollmentId: e.id, at: p.at });
}
