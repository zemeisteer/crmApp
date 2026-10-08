import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import type { Database } from '../db/db.module';
import { groups, lessonCancellations, schedules } from '../db/schema';
import { isoWeekdaysOf } from '../common/weekdays';

type Executor = Pick<Database, 'select'>;

/**
 * One dated lesson of a group. CRMApp keeps a weekly timetable (schedules
 * rows with a weekday, rebuilt whenever the group changes) plus one-off
 * dated rows, and attendance, topics and teacher marks key a lesson by
 * (group, date). This turns that into dated occurrences:
 *  - `uid` is stable for the occurrence: weekly lessons by group and date
 *    (not by schedules.id, which changes on every group edit), a one-off by
 *    its row;
 *  - a day called off in lesson_cancellations stays in the list with
 *    `cancelled: true` (calendars must show it as cancelled, not drop it).
 */
export interface LessonOccurrence {
  uid: string;
  groupId: string;
  date: string; // YYYY-MM-DD, center-local
  startTime: string; // HH:MM
  endTime: string;
  teacherId: string | null;
  roomId: string | null;
  branchId: string | null;
  kind: 'WEEKLY' | 'ONE_OFF';
  scheduleId: string | null;
  cancelled: boolean;
  cancellationId: string | null;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

const localDate = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/**
 * Lessons of the given groups (all the center's when omitted) on dates
 * from..to inclusive (at most ~400 days). Deleted, completed and archived
 * groups have none; a group's lessons start at its start date.
 */
export async function lessonOccurrences(db: Executor, tenantId: string, from: string, to: string, groupIds?: string[]): Promise<LessonOccurrence[]> {
  if (groupIds && groupIds.length === 0) return [];
  const groupRows = await db.select({
    id: groups.id, teacherId: groups.teacherId, branchId: groups.branchId, scheduleDays: groups.scheduleDays,
    startTime: groups.startTime, endTime: groups.endTime, startDate: groups.startDate, status: groups.status,
  }).from(groups).where(and(eq(groups.tenantId, tenantId), isNull(groups.deletedAt), groupIds ? inArray(groups.id, groupIds) : undefined));
  const live = groupRows.filter((g) => g.status !== 'COMPLETED' && g.status !== 'ARCHIVED');
  if (live.length === 0) return [];
  const ids = live.map((g) => g.id);
  const [rows, cancels] = await Promise.all([
    db.select().from(schedules).where(and(eq(schedules.tenantId, tenantId), inArray(schedules.groupId, ids))),
    db.select().from(lessonCancellations).where(and(eq(lessonCancellations.tenantId, tenantId), inArray(lessonCancellations.groupId, ids), gte(lessonCancellations.date, from), lte(lessonCancellations.date, to))),
  ]);
  const cancelled = new Map(cancels.map((c) => [`${c.groupId}|${c.date}`, c.id]));
  const dates = datesBetween(from, to);
  const out: LessonOccurrence[] = [];
  for (const g of live) {
    const start = localDate(g.startDate);
    const mine = rows.filter((r) => r.groupId === g.id && r.status !== 'CANCELLED');
    const weekly = mine.filter((r) => !r.date && r.dayOfWeek).sort((a, b) => a.startTime.localeCompare(b.startTime));
    // Groups from before weekly rows existed: their own days and times.
    const fallback = weekly.length === 0 && mine.every((r) => r.date) && g.startTime
      ? isoWeekdaysOf(g.scheduleDays).map((dow) => ({ id: null as string | null, dayOfWeek: dow, startTime: g.startTime!, endTime: g.endTime || g.startTime!, teacherId: g.teacherId, roomId: null as string | null, branchId: g.branchId }))
      : [];
    const slots = weekly.length ? weekly : fallback;
    for (const date of dates) {
      if (start && date < start) continue;
      const dow = isoWeekday(date);
      const today = slots.filter((s) => s.dayOfWeek === dow);
      today.forEach((s, i) => {
        const key = `${g.id}|${date}`;
        out.push({
          uid: i === 0 ? `grp-${g.id}-${date}` : `grp-${g.id}-${date}-${i + 1}`,
          groupId: g.id, date, startTime: s.startTime, endTime: s.endTime,
          teacherId: s.teacherId ?? g.teacherId ?? null, roomId: s.roomId ?? null, branchId: s.branchId ?? g.branchId ?? null,
          kind: 'WEEKLY', scheduleId: s.id, cancelled: cancelled.has(key), cancellationId: cancelled.get(key) ?? null,
        });
      });
    }
    for (const r of mine.filter((x) => x.date && x.date >= from && x.date <= to)) {
      out.push({
        uid: `one-${r.id}`, groupId: g.id, date: r.date!, startTime: r.startTime, endTime: r.endTime,
        teacherId: r.teacherId ?? g.teacherId ?? null, roomId: r.roomId, branchId: r.branchId ?? g.branchId ?? null,
        kind: 'ONE_OFF', scheduleId: r.id, cancelled: false, cancellationId: null,
      });
    }
  }
  return out.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
}

/** The group's lessons on one date (not cancelled ones unless asked). */
export async function lessonsOfGroupOn(db: Executor, tenantId: string, groupId: string, date: string, includeCancelled = false) {
  const all = await lessonOccurrences(db, tenantId, date, date, [groupId]);
  return includeCancelled ? all : all.filter((o) => !o.cancelled);
}
