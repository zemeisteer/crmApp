import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groups, teacherAttendance, teachers } from '../db/schema';
import { lockTimetable } from '../common/timetable-lock';
import { isDate, lessonOccurrences, type LessonOccurrence } from '../lessons/occurrences';

export type TeacherMark = 'PRESENT' | 'LATE' | 'ABSENT';

export function isoWeekday(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

// Dates of a month that fall on the given ISO weekday.
export function datesInMonth(month: string, weekday: number) {
  const [y, m] = month.split('-').map(Number);
  const out: string[] = [];
  for (let d = 1; d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    if (isoWeekday(date) === weekday) out.push(date);
  }
  return out;
}

/**
 * One teacher's month, counted in one unit: a lesson (a timetable occurrence,
 * lessons/occurrences.ts). `planned` is every lesson the timetable gives the
 * teacher that month and does not call off; `absent`, `late` and
 * `substituted` are marks on those same lessons. A mark of a lesson called
 * off (or no longer on the timetable that day) is not counted - it is in
 * `unmatched` for the office to look at. An old day-level mark (from before
 * marks were per lesson) counts once, never once per lesson of that day.
 */
export interface TeacherMonthStats {
  planned: number;
  absent: number;
  late: number;
  // Lessons this teacher taught in someone else's place.
  substituted: number;
  // Marks of this teacher's that match no lesson held that day.
  unmatched: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;
type Mark = typeof teacherAttendance.$inferSelect;

const lessonKey = (scheduleId: string | null, groupId: string, date: string) => (scheduleId ? `s|${scheduleId}|${date}` : `g|${groupId}|${date}`);

@Injectable()
export class TeacherAttendanceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * The lessons on a date, one entry per lesson (a group with a morning and
   * an evening lesson has two), each with its teacher - the timetable row's,
   * else the group's - and its own mark. A lesson called off is listed as
   * such and cannot be marked. An old mark for the group's whole day is that
   * lesson's when the group has one lesson that day; with several it is
   * shown beside each as `dayStatus` and is none's own.
   */
  async day(tenantId: string, date: string, db: Executor = this.db) {
    if (!isDate(date)) throw new BadRequestException("Sana noto'g'ri");
    const lessons = await lessonOccurrences(db, tenantId, date, date);
    const groupIds = [...new Set(lessons.map((l) => l.groupId))];
    const [groupRows, marks] = groupIds.length
      ? await Promise.all([
          db.select({ id: groups.id, name: groups.name }).from(groups).where(inArray(groups.id, groupIds)),
          db.select().from(teacherAttendance).where(and(eq(teacherAttendance.tenantId, tenantId), eq(teacherAttendance.date, date), inArray(teacherAttendance.groupId, groupIds))),
        ])
      : [[], [] as Mark[]];
    const teacherIds = [...new Set([...lessons.map((l) => l.teacherId), ...marks.map((m) => m.teacherId)].filter((x): x is string => Boolean(x)))];
    const teacherRows = teacherIds.length
      ? await db.select({ id: teachers.id, fullName: teachers.fullName }).from(teachers).where(inArray(teachers.id, teacherIds))
      : [];
    const nameOf = (id: string | null) => teacherRows.find((t) => t.id === id)?.fullName ?? null;
    const held = (groupId: string) => lessons.filter((l) => l.groupId === groupId && !l.cancelled);

    return lessons.map((l) => {
      const own = marks.find((m) => (l.scheduleId ? m.scheduleId === l.scheduleId : !m.scheduleId && m.groupId === l.groupId));
      const dayMark = l.scheduleId ? marks.find((m) => !m.scheduleId && m.groupId === l.groupId) : undefined;
      // A day-level mark is this lesson's own when it is the group's only lesson held that day.
      const mark = own ?? (dayMark && !l.cancelled && held(l.groupId).length === 1 ? dayMark : undefined);
      return {
        scheduleId: l.scheduleId,
        groupId: l.groupId,
        groupName: groupRows.find((g) => g.id === l.groupId)?.name ?? '',
        startTime: l.startTime,
        endTime: l.endTime,
        cancelled: l.cancelled,
        teacherId: l.teacherId,
        teacherName: nameOf(l.teacherId),
        status: (mark?.status as TeacherMark | undefined) ?? null,
        dayStatus: !mark && dayMark ? (dayMark.status as TeacherMark) : null,
        substituteTeacherId: mark?.substituteTeacherId ?? null,
        note: mark?.note ?? null,
      };
    });
  }

  /**
   * Marks lessons of a date. Each entry names its lesson (`scheduleId`); it
   * may be left out only when the group has one lesson that day. The teacher
   * on the mark is the lesson's own (the timetable row's, else the group's).
   * All entries are saved together or none.
   */
  async mark(
    tenantId: string,
    userId: string,
    date: string,
    entries: Array<{ groupId: string; scheduleId?: string | null; status: TeacherMark; substituteTeacherId?: string | null; note?: string | null }>,
  ) {
    if (!isDate(date)) throw new BadRequestException("Sana noto'g'ri");
    return this.db.transaction(async (tx) => {
      // One writer at a time with the timetable (a lesson moved or called off meanwhile).
      await lockTimetable(tx, tenantId);
      const lessons = await lessonOccurrences(tx, tenantId, date, date);
      const seen = new Set<string>();
      for (const e of entries) {
        const lesson = this.lessonFor(lessons, e.groupId, e.scheduleId ?? null);
        const key = lessonKey(lesson.scheduleId, lesson.groupId, date);
        if (seen.has(key)) throw new BadRequestException('Bir dars ikki marta belgilanmasin');
        seen.add(key);
        if (lesson.cancelled) throw new BadRequestException("Bu dars bekor qilingan: o'qituvchi davomati yozilmaydi");
        if (!lesson.teacherId) throw new BadRequestException("Bu darsga o'qituvchi biriktirilmagan");
        const substitute = e.status === 'ABSENT' ? e.substituteTeacherId || null : null;
        if (substitute) {
          const [ok] = await tx.select({ id: teachers.id }).from(teachers)
            .where(and(eq(teachers.id, substitute), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
          if (!ok || substitute === lesson.teacherId) throw new BadRequestException("O'rinbosar o'qituvchi noto'g'ri");
        }
        const values = {
          teacherId: lesson.teacherId, status: e.status, substituteTeacherId: substitute,
          note: e.note?.trim() || null, markedByUserId: userId, startTime: lesson.startTime, updatedAt: new Date(),
        };
        if (lesson.scheduleId) {
          // The group's only lesson that day may still have an old day-level
          // mark: it becomes this lesson's (moved, not copied).
          if (lessons.filter((l) => l.groupId === lesson.groupId && !l.cancelled).length === 1) {
            await tx.delete(teacherAttendance).where(and(
              eq(teacherAttendance.tenantId, tenantId), eq(teacherAttendance.groupId, lesson.groupId), eq(teacherAttendance.date, date), isNull(teacherAttendance.scheduleId),
            ));
          }
          await tx.insert(teacherAttendance).values({ tenantId, groupId: lesson.groupId, scheduleId: lesson.scheduleId, date, ...values })
            .onConflictDoUpdate({ target: [teacherAttendance.scheduleId, teacherAttendance.date], targetWhere: sql`schedule_id IS NOT NULL`, set: values });
        } else {
          await tx.insert(teacherAttendance).values({ tenantId, groupId: lesson.groupId, scheduleId: null, date, ...values })
            .onConflictDoUpdate({ target: [teacherAttendance.groupId, teacherAttendance.date], targetWhere: sql`schedule_id IS NULL`, set: values });
        }
      }
      return this.day(tenantId, date, tx);
    });
  }

  private lessonFor(lessons: LessonOccurrence[], groupId: string, scheduleId: string | null): LessonOccurrence {
    const ofGroup = lessons.filter((l) => l.groupId === groupId);
    if (scheduleId) {
      const named = ofGroup.find((l) => l.scheduleId === scheduleId);
      if (!named) throw new BadRequestException("Bu kuni bu guruhning bunday darsi yo'q");
      return named;
    }
    if (ofGroup.length === 0) throw new BadRequestException("Bu kuni bu guruhning darsi yo'q");
    if (ofGroup.length > 1) {
      throw new BadRequestException({ code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bor: qaysi biri ekanini tanlang', lessons: ofGroup.map((l) => ({ scheduleId: l.scheduleId, startTime: l.startTime, endTime: l.endTime })) });
    }
    return ofGroup[0];
  }

  // Per teacher for a month, in lessons (see TeacherMonthStats).
  async monthStats(tenantId: string, month: string): Promise<Map<string, TeacherMonthStats>> {
    const stats = new Map<string, TeacherMonthStats>();
    const get = (id: string) => {
      if (!stats.has(id)) stats.set(id, { planned: 0, absent: 0, late: 0, substituted: 0, unmatched: 0 });
      return stats.get(id)!;
    };
    const [y, m] = month.split('-').map(Number);
    const last = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const lessons = await lessonOccurrences(this.db, tenantId, `${month}-01`, last);
    const held = new Set<string>();
    const heldOfGroupDay = new Map<string, number>();
    for (const l of lessons) {
      if (l.cancelled) continue;
      held.add(lessonKey(l.scheduleId, l.groupId, l.date));
      heldOfGroupDay.set(`${l.groupId}|${l.date}`, (heldOfGroupDay.get(`${l.groupId}|${l.date}`) ?? 0) + 1);
      if (l.teacherId) get(l.teacherId).planned += 1;
    }
    const marks = await this.db.select().from(teacherAttendance)
      .where(and(eq(teacherAttendance.tenantId, tenantId), like(teacherAttendance.date, `${month}-%`)));
    for (const mk of marks) {
      // A lesson's mark counts when that lesson was held; a day-level one when the group had a lesson that day.
      const counts = mk.scheduleId
        ? held.has(lessonKey(mk.scheduleId, mk.groupId, mk.date))
        : (heldOfGroupDay.get(`${mk.groupId}|${mk.date}`) ?? 0) > 0;
      if (!counts) {
        get(mk.teacherId).unmatched += 1;
        continue;
      }
      if (mk.status === 'ABSENT') get(mk.teacherId).absent += 1;
      if (mk.status === 'LATE') get(mk.teacherId).late += 1;
      if (mk.substituteTeacherId) get(mk.substituteTeacherId).substituted += 1;
    }
    return stats;
  }
}
