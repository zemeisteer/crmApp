import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, ne } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groups, schedules, teacherAttendance, teachers } from '../db/schema';

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

export interface TeacherMonthStats {
  planned: number;
  absent: number;
  late: number;
  // Lessons this teacher taught in someone else's place.
  substituted: number;
}

@Injectable()
export class TeacherAttendanceService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // The lessons on a date (from the weekly timetable plus one-off lessons),
  // each with its teacher and any mark already made.
  async day(tenantId: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException("Sana noto'g'ri");
    const rows = await this.db
      .select({
        groupId: groups.id,
        groupName: groups.name,
        teacherId: groups.teacherId,
        startTime: schedules.startTime,
        endTime: schedules.endTime,
        dayOfWeek: schedules.dayOfWeek,
        date: schedules.date,
      })
      .from(schedules)
      .innerJoin(groups, eq(groups.id, schedules.groupId))
      .where(and(
        eq(schedules.tenantId, tenantId),
        ne(schedules.status, 'CANCELLED'),
        isNull(groups.deletedAt),
        eq(groups.status, 'ACTIVE'),
      ));
    const weekday = isoWeekday(date);
    const lessons = rows.filter((r) => (r.date ? r.date === date : r.dayOfWeek === weekday));
    const seen = new Set<string>();
    const unique = lessons.filter((l) => (seen.has(l.groupId) ? false : (seen.add(l.groupId), true)));

    const teacherIds = [...new Set(unique.map((l) => l.teacherId).filter((x): x is string => Boolean(x)))];
    const teacherRows = teacherIds.length
      ? await this.db.select({ id: teachers.id, fullName: teachers.fullName }).from(teachers).where(inArray(teachers.id, teacherIds))
      : [];
    const marks = unique.length
      ? await this.db.select().from(teacherAttendance).where(and(
          eq(teacherAttendance.tenantId, tenantId),
          eq(teacherAttendance.date, date),
          inArray(teacherAttendance.groupId, unique.map((l) => l.groupId)),
        ))
      : [];
    return unique
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((l) => {
        const mark = marks.find((m) => m.groupId === l.groupId);
        return {
          groupId: l.groupId,
          groupName: l.groupName,
          startTime: l.startTime,
          endTime: l.endTime,
          teacherId: l.teacherId,
          teacherName: teacherRows.find((t) => t.id === l.teacherId)?.fullName ?? null,
          status: (mark?.status as TeacherMark | undefined) ?? null,
          substituteTeacherId: mark?.substituteTeacherId ?? null,
          note: mark?.note ?? null,
        };
      });
  }

  async mark(
    tenantId: string,
    userId: string,
    date: string,
    entries: Array<{ groupId: string; status: TeacherMark; substituteTeacherId?: string | null; note?: string | null }>,
  ) {
    const lessons = await this.day(tenantId, date);
    for (const e of entries) {
      const lesson = lessons.find((l) => l.groupId === e.groupId);
      if (!lesson) throw new BadRequestException('Bu kuni bu guruhning darsi yo\'q');
      if (!lesson.teacherId) throw new BadRequestException(`"${lesson.groupName}" guruhiga o'qituvchi biriktirilmagan`);
      const substitute = e.status === 'ABSENT' ? e.substituteTeacherId || null : null;
      if (substitute) {
        const [ok] = await this.db.select({ id: teachers.id }).from(teachers)
          .where(and(eq(teachers.id, substitute), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
        if (!ok || substitute === lesson.teacherId) throw new BadRequestException("O'rinbosar o'qituvchi noto'g'ri");
      }
      await this.db.insert(teacherAttendance).values({
        tenantId, groupId: e.groupId, teacherId: lesson.teacherId, date, status: e.status,
        substituteTeacherId: substitute, note: e.note?.trim() || null, markedByUserId: userId,
      }).onConflictDoUpdate({
        target: [teacherAttendance.groupId, teacherAttendance.date],
        set: { teacherId: lesson.teacherId, status: e.status, substituteTeacherId: substitute, note: e.note?.trim() || null, markedByUserId: userId, updatedAt: new Date() },
      });
    }
    return this.day(tenantId, date);
  }

  // Per teacher for a month: lessons planned by the weekly timetable, and
  // marked absences, late arrivals and substitutions.
  async monthStats(tenantId: string, month: string): Promise<Map<string, TeacherMonthStats>> {
    const stats = new Map<string, TeacherMonthStats>();
    const get = (id: string) => {
      if (!stats.has(id)) stats.set(id, { planned: 0, absent: 0, late: 0, substituted: 0 });
      return stats.get(id)!;
    };
    const weekly = await this.db
      .select({ teacherId: groups.teacherId, dayOfWeek: schedules.dayOfWeek, date: schedules.date })
      .from(schedules)
      .innerJoin(groups, eq(groups.id, schedules.groupId))
      .where(and(eq(schedules.tenantId, tenantId), ne(schedules.status, 'CANCELLED'), isNull(groups.deletedAt)));
    for (const s of weekly) {
      if (!s.teacherId) continue;
      if (s.date) {
        if (s.date.startsWith(month)) get(s.teacherId).planned += 1;
      } else if (s.dayOfWeek) {
        get(s.teacherId).planned += datesInMonth(month, s.dayOfWeek).length;
      }
    }
    const marks = await this.db.select().from(teacherAttendance)
      .where(and(eq(teacherAttendance.tenantId, tenantId), like(teacherAttendance.date, `${month}-%`)));
    for (const m of marks) {
      if (m.status === 'ABSENT') get(m.teacherId).absent += 1;
      if (m.status === 'LATE') get(m.teacherId).late += 1;
      if (m.substituteTeacherId) get(m.substituteTeacherId).substituted += 1;
    }
    return stats;
  }
}
