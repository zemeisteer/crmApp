import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, eq, gte, ne, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DB, Database } from '../db/db.module';
import { enrollments, groups, lessonCancellations, makeupBookings, rooms, schedules, students, teachers } from '../db/schema';
import { effectiveAccess } from '../access/catalog';
import { AuditService } from '../audit/audit.service';
import { centerToday } from '../common/center-today';
import { TEACHER_PUBLIC_COLUMNS } from '../common/teacher-columns';
import { assertTeacherGroups, Viewer } from '../common/teacher-scope';
import { lockTimetable } from '../common/timetable-lock';
import { MakeupReconcile, reconcileGroupMakeups } from '../lessons/makeup-reconcile';
import { CreateRoomDto, UpdateRoomDto } from './dto/room.dto';
import { CheckConflictDto, CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';

export interface ScheduleConflict {
  /** MAKEUP: the teacher or the room is taken by a make-up session. */
  type: 'ROOM' | 'TEACHER' | 'GROUP' | 'STUDENT' | 'MAKEUP';
  message: string;
  /** The timetable row in the way; null when it is a make-up booking. */
  conflictingScheduleId: string | null;
  /** STUDENT: who would have two lessons at once (first few names) and how many in all. */
  studentNames?: string[];
  studentCount?: number;
  /** STUDENT: the other lesson is the student's make-up, not a group lesson. */
  makeup?: boolean;
  /** The group whose lesson is in the way (not set for a make-up session). */
  groupId?: string;
  groupName?: string;
  roomName?: string;
  teacherName?: string;
  startTime: string;
  endTime: string;
  dayOfWeek?: number | null;
  date?: string | null;
}

/** Who is asking, with their access list: decides whether students are named. */
export interface ConflictViewer extends Viewer {
  access?: string[] | null;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isOverlapping(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

// ISO weekday (1 = Monday … 7 = Sunday) of a "YYYY-MM-DD" calendar date.
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

// Whether two lessons can fall on the same day. A lesson with a `date` is a
// one-off on that date; otherwise it recurs weekly on `dayOfWeek`.
//  - one-off vs one-off: same date;
//  - anything involving a recurring lesson: same weekday, taking a one-off
//    lesson's weekday from its date.
export function occursOnSameDay(
  a: { dayOfWeek?: number | null; date?: string | null },
  b: { dayOfWeek?: number | null; date?: string | null },
): boolean {
  if (a.date && b.date) return a.date === b.date;
  const dowA = a.date ? isoWeekday(a.date) : a.dayOfWeek;
  const dowB = b.date ? isoWeekday(b.date) : b.dayOfWeek;
  return !!dowA && dowA === dowB;
}

/** The text of a student clash, with the names or with a count only. */
export function studentConflictMessage(c: Pick<ScheduleConflict, 'studentNames' | 'studentCount' | 'groupName' | 'startTime' | 'endTime' | 'makeup' | 'date'>, withNames: boolean): string {
  const count = c.studentCount ?? c.studentNames?.length ?? 0;
  const names = c.studentNames ?? [];
  const more = count - names.length;
  const who = withNames && names.length
    ? `${names.join(', ')}${more > 0 ? ` va yana ${more} nafar` : ''}`
    : `${count} nafar o'quvchi`;
  const where = c.makeup
    ? `qoplash darsida${c.date ? ` (${c.date})` : ''}`
    : `boshqa darsda: ${c.groupName || 'Guruh'}`;
  return `${who} bu vaqtda ${where} (${c.startTime} - ${c.endTime})`;
}

/**
 * What this viewer may read in a list of clashes. Rooms, teachers and
 * groups are the timetable everyone with schedule.view already sees.
 * Students are not: who is enrolled where is named only for someone who
 * both plans the timetable (schedule.edit) and may open the students list
 * (students.view). Everyone else gets the count, in the message as well.
 */
export function redactConflicts(conflicts: ScheduleConflict[], viewer: ConflictViewer | undefined): ScheduleConflict[] {
  const access = viewer?.role ? effectiveAccess(viewer.role, viewer.access) : [];
  const named = access.includes('schedule.edit') && access.includes('students.view');
  return conflicts.map((c) => {
    if (c.type !== 'STUDENT') return c;
    if (named) return { ...c, message: studentConflictMessage(c, true) };
    const { studentNames: _names, ...rest } = c;
    return { ...rest, message: studentConflictMessage(c, false) };
  });
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

// A group's first day of lessons, as lessons/occurrences.ts reads it.
const startDay = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);
// Groups that hold no lessons any more (lessons/occurrences.ts gives them none).
const HOLDS_NO_LESSONS = ['COMPLETED', 'ARCHIVED'];

/** Advisory locks for a lesson slot: teacher, room, group - always in this order. */
async function lockSlot(tx: Tx, tenantId: string, teacherId: string | null, roomId: string | null, groupId: string) {
  for (const key of [teacherId && `trial:t:${tenantId}:${teacherId}`, roomId && `trial:r:${tenantId}:${roomId}`, `sched:g:${groupId}`]) {
    if (key) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
  }
}

// The names the group form stores in groups.scheduleDays (common/weekdays.ts).
const DAY_NAMES = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];

/**
 * The group form shows the days and hours of the group's weekly lessons,
 * and rebuilds the timetable rows when they are edited there. So when the
 * rows are edited on the timetable instead, the form's copy has to follow:
 * otherwise a lesson moved or removed here still stands on the group (in
 * its card, in reminders and reports that read the days from it), and the
 * day cannot be put back from the form because the form "has not changed".
 * Days: the weekdays that still have a live weekly row. Hours: only when
 * every row has the same ones (the form holds one pair for the group).
 */
export async function mirrorTimetableOnGroup(tx: Tx, tenantId: string, groupId: string) {
  const live = await tx.select({ dayOfWeek: schedules.dayOfWeek, startTime: schedules.startTime, endTime: schedules.endTime }).from(schedules)
    .where(and(eq(schedules.groupId, groupId), eq(schedules.tenantId, tenantId), isNull(schedules.date), ne(schedules.status, 'CANCELLED')));
  const days = [...new Set(live.map((r) => r.dayOfWeek).filter((d): d is number => !!d))].sort((a, b) => a - b);
  const scheduleDays = days.length ? days.map((d) => DAY_NAMES[d - 1]).join(',') : null;
  const sameHours = live.length > 0 && live.every((r) => r.startTime === live[0].startTime && r.endTime === live[0].endTime);
  await tx.update(groups)
    .set({ scheduleDays, ...(sameHours ? { startTime: live[0].startTime, endTime: live[0].endTime } : {}), timetableManaged: true, updatedAt: new Date() })
    .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
}

@Injectable()
export class ScheduleService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ==================== ROOMS CRUD ====================

  async findAllRooms(tenantId: string) {
    return this.db.query.rooms.findMany({
      where: eq(rooms.tenantId, tenantId),
      with: { branch: true },
      orderBy: (r, { asc }) => asc(r.name),
    });
  }

  async findOneRoom(tenantId: string, id: string) {
    const room = await this.db.query.rooms.findFirst({
      where: and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)),
      with: { branch: true },
    });
    if (!room) throw new NotFoundException('Xona topilmadi');
    return room;
  }

  async createRoom(tenantId: string, dto: CreateRoomDto) {
    const [room] = await this.db
      .insert(rooms)
      .values({
        tenantId,
        name: dto.name,
        branchId: dto.branchId || null,
        capacity: dto.capacity ?? 20,
        color: dto.color ?? '#4F46E5',
      })
      .returning();
    return room;
  }

  async updateRoom(tenantId: string, id: string, dto: UpdateRoomDto) {
    await this.findOneRoom(tenantId, id);
    const [updated] = await this.db
      .update(rooms)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)))
      .returning();
    return updated;
  }

  async deleteRoom(tenantId: string, id: string) {
    await this.findOneRoom(tenantId, id);
    await this.db.delete(rooms).where(and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)));
    return { success: true };
  }

  // ==================== CONFLICT ENGINE ====================

  /**
   * What is in the way of a lesson at this time. `db` is the caller's
   * transaction when the answer decides a write (so it reads what the
   * holder of the timetable lock left), the pool for a plain question.
   *
   * This is the one rule for every writer - the timetable page, the group
   * form, a group being restored, a cancelled lesson being put back, a
   * make-up session - and it follows what lessons/occurrences.ts says is a
   * lesson:
   *  - a deleted, completed or archived group holds nothing up;
   *  - a weekly lesson is not in the way of something dated on a day it is
   *    called off, or before its group starts;
   *  - a weekly lesson being planned is not held up by dated lessons of the
   *    past, nor by ones before its own group starts.
   */
  async findConflicts(
    tenantId: string,
    params: {
      groupId: string;
      teacherId?: string | null;
      roomId?: string | null;
      dayOfWeek?: number | null;
      date?: string | null;
      startTime: string;
      endTime: string;
      excludeScheduleId?: string;
      /** Group lessons only: also report students enrolled in two overlapping groups. */
      checkStudents?: boolean;
      /** Group lessons only: also report make-ups (a session's teacher or room, a student's own make-up). */
      checkMakeups?: boolean;
    },
    db: Executor = this.db,
  ): Promise<ScheduleConflict[]> {
    const { groupId, teacherId, roomId, dayOfWeek, date, startTime, endTime, excludeScheduleId, checkStudents, checkMakeups } = params;

    // Fetch active candidates for this tenant
    const candidates = await db.query.schedules.findMany({
      where: and(
        eq(schedules.tenantId, tenantId),
        ne(schedules.status, 'CANCELLED'),
      ),
      with: {
        group: true,
        teacher: { columns: TEACHER_PUBLIC_COLUMNS },
        room: true,
      },
    });

    const conflicts: ScheduleConflict[] = [];
    // Students enrolled in this group and in another one cannot sit two
    // lessons at once (looked up only when another group overlaps).
    let shared: Map<string, { names: string[]; count: number }> | null = null;

    // Dated: the lessons called off that day. Weekly: today, and the day the
    // group's own lessons begin.
    const calledOff = new Set<string>();
    let notBefore: string | null = null;
    if (date) {
      const rows = await db.select({ groupId: lessonCancellations.groupId, scheduleId: lessonCancellations.scheduleId }).from(lessonCancellations)
        .where(and(eq(lessonCancellations.tenantId, tenantId), eq(lessonCancellations.date, date)));
      for (const r of rows) calledOff.add(r.scheduleId ? `s|${r.scheduleId}` : `g|${r.groupId}`);
    } else {
      const [own] = await db.select({ startDate: groups.startDate }).from(groups).where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId)));
      const today = await centerToday(db, tenantId);
      const begins = startDay(own?.startDate);
      notBefore = begins && begins > today ? begins : today;
    }

    for (const c of candidates) {
      if (excludeScheduleId && c.id === excludeScheduleId) continue;
      // A deleted group's rows are kept for a restore; they hold nothing up.
      if (c.group?.deletedAt) continue;
      if (c.group && HOLDS_NO_LESSONS.includes(c.group.status)) continue;

      if (!occursOnSameDay({ dayOfWeek, date }, c)) continue;
      if (date && !c.date) {
        // That weekly lesson is not held on this date.
        if (calledOff.has(`s|${c.id}`) || calledOff.has(`g|${c.groupId}`)) continue;
        const begins = startDay(c.group?.startDate);
        if (begins && date < begins) continue;
      }
      if (!date && c.date && notBefore && c.date < notBefore) continue;

      // Check time overlap
      if (!isOverlapping(startTime, endTime, c.startTime, c.endTime)) continue;

      // 1. Room collision
      if (roomId && c.roomId === roomId) {
        conflicts.push({
          type: 'ROOM',
          message: `"${c.room?.name || 'Xona'}" bu vaqtda band: ${c.group?.name || 'Boshqa guruh'} (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          groupId: c.groupId,
          roomName: c.room?.name,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }

      // 2. Teacher collision
      if (teacherId && c.teacherId === teacherId) {
        conflicts.push({
          type: 'TEACHER',
          message: `"${c.teacher?.fullName || "O'qituvchi"}" bu vaqtda boshqa darsda: ${c.group?.name || 'Guruh'} (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          groupId: c.groupId,
          teacherName: c.teacher?.fullName,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }

      // 3. Group collision
      if (groupId && c.groupId === groupId) {
        conflicts.push({
          type: 'GROUP',
          message: `"${c.group?.name || 'Guruh'}" uchun bu vaqtda boshqa dars belgilangan (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          groupId: c.groupId,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }

      // 4. Student collision
      if (checkStudents && groupId && c.groupId !== groupId) {
        shared ??= await this.sharedStudents(db, tenantId, groupId);
        const both = shared.get(c.groupId);
        if (both) {
          const conflict: ScheduleConflict = {
            type: 'STUDENT',
            message: '',
            conflictingScheduleId: c.id,
            groupId: c.groupId,
            groupName: c.group?.name,
            studentNames: both.names,
            studentCount: both.count,
            startTime: c.startTime,
            endTime: c.endTime,
            dayOfWeek: c.dayOfWeek,
            date: c.date,
          };
          conflict.message = studentConflictMessage(conflict, true);
          conflicts.push(conflict);
        }
      }
    }

    if (checkMakeups) conflicts.push(...(await this.makeupConflicts(db, tenantId, params)));
    return conflicts;
  }

  /**
   * Make-ups a lesson at this time would run into: a make-up session held
   * by the same teacher or in the same room, and a make-up one of this
   * group's students is booked for. A weekly lesson is checked against the
   * make-ups from today on that fall on its weekday; a dated one against
   * its date.
   */
  private async makeupConflicts(
    db: Executor,
    tenantId: string,
    p: { groupId: string; teacherId?: string | null; roomId?: string | null; dayOfWeek?: number | null; date?: string | null; startTime: string; endTime: string; checkStudents?: boolean },
  ): Promise<ScheduleConflict[]> {
    const dow = p.date ? isoWeekday(p.date) : p.dayOfWeek;
    if (!dow) return [];
    const rows = await db.select({
      id: makeupBookings.id, mode: makeupBookings.mode, date: makeupBookings.date, startTime: makeupBookings.startTime, endTime: makeupBookings.endTime,
      teacherId: makeupBookings.teacherId, roomId: makeupBookings.roomId, targetGroupId: makeupBookings.targetGroupId,
      studentId: makeupBookings.studentId, studentName: students.fullName, teacherName: teachers.fullName, roomName: rooms.name,
    }).from(makeupBookings)
      .innerJoin(students, eq(students.id, makeupBookings.studentId))
      .leftJoin(teachers, eq(teachers.id, makeupBookings.teacherId))
      .leftJoin(rooms, eq(rooms.id, makeupBookings.roomId))
      .where(and(
        eq(makeupBookings.tenantId, tenantId), eq(makeupBookings.status, 'BOOKED'),
        p.date ? eq(makeupBookings.date, p.date) : gte(makeupBookings.date, await centerToday(db, tenantId)),
      ));
    let overlapping = rows.filter((b) => isoWeekday(b.date) === dow && isOverlapping(p.startTime, p.endTime, b.startTime, b.endTime));
    if (overlapping.length && !p.date) {
      // A weekly lesson of a group that has not started is not held before it does.
      const [own] = await db.select({ startDate: groups.startDate }).from(groups).where(and(eq(groups.id, p.groupId), eq(groups.tenantId, tenantId)));
      const begins = startDay(own?.startDate);
      if (begins) overlapping = overlapping.filter((b) => b.date >= begins);
    }
    if (overlapping.length === 0) return [];

    const mine = p.checkStudents && p.groupId
      ? new Set((await db.select({ id: enrollments.studentId }).from(enrollments).where(and(eq(enrollments.groupId, p.groupId), eq(enrollments.status, 'ACTIVE')))).map((e) => e.id))
      : new Set<string>();

    const out: ScheduleConflict[] = [];
    for (const b of overlapping) {
      const base = { conflictingScheduleId: null, startTime: b.startTime, endTime: b.endTime, date: b.date, dayOfWeek: null };
      if (b.mode === 'SESSION' && p.teacherId && b.teacherId === p.teacherId) {
        out.push({ ...base, type: 'MAKEUP', teacherName: b.teacherName ?? undefined, message: `"${b.teacherName || "O'qituvchi"}" bu vaqtda qoplash darsida (${b.date}, ${b.startTime} - ${b.endTime})` });
      }
      if (b.mode === 'SESSION' && p.roomId && b.roomId === p.roomId) {
        out.push({ ...base, type: 'MAKEUP', roomName: b.roomName ?? undefined, message: `"${b.roomName || 'Xona'}" bu vaqtda qoplash darsi bilan band (${b.date}, ${b.startTime} - ${b.endTime})` });
      }
      // A make-up inside this group's own lesson is that lesson, not a clash with it.
      if (mine.has(b.studentId) && !(b.mode === 'GROUP_LESSON' && b.targetGroupId === p.groupId)) {
        const conflict: ScheduleConflict = { ...base, type: 'STUDENT', makeup: true, studentNames: [b.studentName], studentCount: 1, message: '' };
        conflict.message = studentConflictMessage(conflict, true);
        out.push(conflict);
      }
    }
    return out;
  }

  /** Other groups that share active students with this one: group id -> the students. */
  private async sharedStudents(db: Executor, tenantId: string, groupId: string) {
    const other = alias(enrollments, 'other_enrollment');
    const rows = await db
      .select({ groupId: other.groupId, fullName: students.fullName })
      .from(enrollments)
      .innerJoin(other, and(eq(other.studentId, enrollments.studentId), ne(other.groupId, enrollments.groupId), eq(other.status, 'ACTIVE')))
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(
        eq(enrollments.groupId, groupId), eq(enrollments.status, 'ACTIVE'),
        eq(students.tenantId, tenantId), eq(students.status, 'ACTIVE'), isNull(students.deletedAt),
      ))
      .orderBy(students.fullName);
    const map = new Map<string, { names: string[]; count: number }>();
    for (const r of rows) {
      const entry = map.get(r.groupId) ?? { names: [], count: 0 };
      entry.count += 1;
      if (entry.names.length < 3) entry.names.push(r.fullName);
      map.set(r.groupId, entry);
    }
    return map;
  }

  /**
   * "Would this lesson fit?" - for the forms. The group must be one of the
   * center's (a made-up or another center's id is "not found", and tells
   * nothing about it), a teacher asks about their own groups only, and the
   * answer names students only to those allowed to see them.
   */
  async checkConflicts(tenantId: string, dto: CheckConflictDto, viewer?: ConflictViewer): Promise<{ hasConflict: boolean; conflicts: ScheduleConflict[] }> {
    const [group] = await this.db.select({ id: groups.id }).from(groups)
      .where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
    if (!group) throw new NotFoundException('Guruh topilmadi');
    await assertTeacherGroups(this.db, tenantId, viewer, [dto.groupId]);
    const conflicts = await this.findConflicts(tenantId, {
      checkStudents: true,
      checkMakeups: true,
      groupId: dto.groupId,
      teacherId: dto.teacherId,
      roomId: dto.roomId,
      dayOfWeek: dto.dayOfWeek,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      excludeScheduleId: dto.excludeScheduleId,
    });
    return { hasConflict: conflicts.length > 0, conflicts: redactConflicts(conflicts, viewer) };
  }

  // ==================== SCHEDULES CRUD ====================

  async findAllSchedules(
    tenantId: string,
    filters?: {
      branchId?: string;
      groupId?: string;
      teacherId?: string;
      roomId?: string;
      dayOfWeek?: number;
    },
  ) {
    const all = await this.db.query.schedules.findMany({
      where: eq(schedules.tenantId, tenantId),
      with: {
        group: true,
        teacher: { columns: TEACHER_PUBLIC_COLUMNS },
        room: true,
        branch: true,
      },
      orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.startTime)],
    });

    return all.filter((s) => {
      // Lessons of deleted groups stay stored (for restore) but are hidden.
      if (s.group?.deletedAt) return false;
      if (filters?.branchId && s.branchId !== filters.branchId) return false;
      if (filters?.groupId && s.groupId !== filters.groupId) return false;
      if (filters?.teacherId && s.teacherId !== filters.teacherId) return false;
      if (filters?.roomId && s.roomId !== filters.roomId) return false;
      if (filters?.dayOfWeek && s.dayOfWeek !== filters.dayOfWeek) return false;
      return true;
    });
  }

  async findOneSchedule(tenantId: string, id: string) {
    const item = await this.db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)),
      with: {
        group: true,
        teacher: { columns: TEACHER_PUBLIC_COLUMNS },
        room: true,
        branch: true,
      },
    });
    if (!item) throw new NotFoundException('Dars jadvali topilmadi');
    return item;
  }

  private clash(conflicts: ScheduleConflict[], viewer?: ConflictViewer) {
    return new ConflictException({ message: 'Dars jadvalida to\'qnashuv aniqlandi', conflicts: redactConflicts(conflicts, viewer) });
  }

  private auditMakeups(tenantId: string, viewer: ConflictViewer | undefined, scheduleId: string, makeups: MakeupReconcile) {
    if (makeups.moved + makeups.released === 0) return;
    this.audit?.log({ tenantId, userId: viewer?.userId ?? null, action: 'makeup.follow_lesson', entityType: 'schedule', entityId: scheduleId, meta: makeups });
  }

  async createSchedule(tenantId: string, dto: CreateScheduleDto, viewer?: ConflictViewer) {
    // A teacher plans lessons of their own groups only, and never past a clash.
    await assertTeacherGroups(this.db, tenantId, viewer, [dto.groupId]);
    if (viewer?.role === 'TEACHER') dto.allowCollision = false;
    // 1. Verify group exists and belongs to tenant
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    if (dto.roomId) {
      const room = await this.db.query.rooms.findFirst({
        where: and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)),
      });
      if (!room) throw new NotFoundException('Xona topilmadi');
    }

    const teacherId = dto.teacherId || group.teacherId || null;
    const branchId = dto.branchId || group.branchId || null;

    // 2. Collision detection and the insert, one timetable writer at a time
    // for the center (two lessons for different groups and teachers can
    // still share a student), then the teacher, room and group locks lead
    // trials and make-up sessions take. The check reads inside the
    // transaction, after the locks.
    const created = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      await lockSlot(tx, tenantId, teacherId, dto.roomId || null, dto.groupId);
      if (!dto.allowCollision) {
        const conflicts = await this.findConflicts(tenantId, {
          checkStudents: true,
          checkMakeups: true,
          groupId: dto.groupId,
          teacherId,
          roomId: dto.roomId || null,
          dayOfWeek: dto.dayOfWeek,
          date: dto.date,
          startTime: dto.startTime,
          endTime: dto.endTime,
        }, tx);
        if (conflicts.length > 0) throw this.clash(conflicts, viewer);
      }

      const [row] = await tx
        .insert(schedules)
        .values({
          tenantId,
          groupId: dto.groupId,
          teacherId,
          roomId: dto.roomId || null,
          branchId,
          dayOfWeek: dto.dayOfWeek || null,
          date: dto.date || null,
          startTime: dto.startTime,
          endTime: dto.endTime,
          isRecurring: dto.isRecurring ?? true,
          onlineMeetingUrl: dto.onlineMeetingUrl || null,
          status: dto.status ?? 'SCHEDULED',
          topic: dto.topic || null,
        })
        .returning();
      // From here on the group's weekly lessons are what the timetable says.
      if (!row.date) await mirrorTimetableOnGroup(tx, tenantId, dto.groupId);
      return row;
    });

    return this.findOneSchedule(tenantId, created.id);
  }

  /**
   * A change of day, time, room, teacher, group or status. Make-ups booked
   * into the lesson follow it or are released (lessons/makeup-reconcile.ts);
   * `makeups` in the answer says how many of each, for the page to show.
   */
  async updateSchedule(tenantId: string, id: string, dto: UpdateScheduleDto, viewer?: ConflictViewer) {
    const before = await this.findOneSchedule(tenantId, id);
    // A teacher moves lessons of their own groups only (also the target group).
    await assertTeacherGroups(this.db, tenantId, viewer, [before.groupId, dto.groupId ?? before.groupId]);
    if (viewer?.role === 'TEACHER' && 'allowCollision' in dto) (dto as { allowCollision?: boolean }).allowCollision = false;

    if (dto.groupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
      });
      if (!group) throw new NotFoundException('Guruh topilmadi');
    }

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    if (dto.roomId) {
      const room = await this.db.query.rooms.findFirst({
        where: and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)),
      });
      if (!room) throw new NotFoundException('Xona topilmadi');
    }

    const makeups = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      // The row as it is now, under the lock: another edit may have landed
      // since the read above.
      const [current] = await tx.select().from(schedules).where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
      if (!current) throw new NotFoundException('Dars jadvali topilmadi');

      const groupId = dto.groupId ?? current.groupId;
      const teacherId = dto.teacherId !== undefined ? dto.teacherId || null : current.teacherId;
      const roomId = dto.roomId !== undefined ? dto.roomId || null : current.roomId;
      const dayOfWeek = dto.dayOfWeek !== undefined ? dto.dayOfWeek : current.dayOfWeek;
      const date = dto.date !== undefined ? dto.date : current.date;
      const startTime = dto.startTime ?? current.startTime;
      const endTime = dto.endTime ?? current.endTime;
      const status = dto.status ?? current.status;

      await lockSlot(tx, tenantId, teacherId, roomId, groupId);
      // A lesson being called off cannot clash with anything.
      if (!dto.allowCollision && status !== 'CANCELLED') {
        const conflicts = await this.findConflicts(tenantId, {
          checkStudents: true,
          checkMakeups: true,
          groupId,
          teacherId,
          roomId,
          dayOfWeek,
          date,
          startTime,
          endTime,
          excludeScheduleId: id,
        }, tx);
        if (conflicts.length > 0) throw this.clash(conflicts, viewer);
      }

      await tx
        .update(schedules)
        .set({
          ...(dto.groupId !== undefined ? { groupId: dto.groupId } : {}),
          ...(dto.teacherId !== undefined ? { teacherId: dto.teacherId || null } : {}),
          ...(dto.roomId !== undefined ? { roomId: dto.roomId || null } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
          ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek || null } : {}),
          ...(dto.date !== undefined ? { date: dto.date || null } : {}),
          ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
          ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
          ...(dto.isRecurring !== undefined ? { isRecurring: dto.isRecurring } : {}),
          ...(dto.onlineMeetingUrl !== undefined ? { onlineMeetingUrl: dto.onlineMeetingUrl || null } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.topic !== undefined ? { topic: dto.topic || null } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
      if (!date || !current.date) {
        for (const g of new Set([current.groupId, groupId])) await mirrorTimetableOnGroup(tx, tenantId, g);
      }
      return reconcileGroupMakeups(tx, tenantId, [current.groupId, groupId], viewer?.userId ?? null);
    });

    this.auditMakeups(tenantId, viewer, id, makeups);
    return { ...(await this.findOneSchedule(tenantId, id)), makeups };
  }

  /** Removes a lesson from the timetable. Make-ups booked into it are released. */
  async deleteSchedule(tenantId: string, id: string, viewer?: ConflictViewer) {
    await this.findOneSchedule(tenantId, id);
    const makeups = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [row] = await tx.select({ groupId: schedules.groupId, date: schedules.date }).from(schedules).where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
      if (!row) throw new NotFoundException('Dars jadvali topilmadi');
      // Before the row goes: the bookings into this lesson are released while
      // they still say which lesson they were for (the delete blanks that).
      const released = await reconcileGroupMakeups(tx, tenantId, [row.groupId], viewer?.userId ?? null, { gone: [id], note: 'LESSON_REMOVED' });
      await tx.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
      if (!row.date) await mirrorTimetableOnGroup(tx, tenantId, row.groupId);
      return released;
    });
    this.auditMakeups(tenantId, viewer, id, makeups);
    return { success: true, makeups };
  }
}
