import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, courses, enrollments, groupPriceHistory, groups, schedules, students, subjects, teachers, tenants } from '../db/schema';
import { TEACHER_PUBLIC_COLUMNS } from '../common/teacher-columns';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { seatHeldWhere } from '../common/seats';
import { addMinutes, DEFAULT_LESSON_MINUTES, isoWeekdaysOf } from '../common/weekdays';
import { mirrorTimetableOnGroup, redactConflicts, ScheduleService, type ConflictViewer, type ScheduleConflict } from '../schedule/schedule.service';
import { centerToday } from '../common/center-today';
import { assertTeacherGroups } from '../common/teacher-scope';
import { lockTimetable } from '../common/timetable-lock';
import { reconcileGroupMakeups, type MakeupReconcile } from '../lessons/makeup-reconcile';
import { lessonInstant, staysByMember, staysOf, wasMember } from '../enrollments/membership';
import { isDate } from '../lessons/occurrences';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { AuditService } from '../audit/audit.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type GroupRow = typeof groups.$inferSelect;
type LessonRow = typeof schedules.$inferSelect;

/** Whether the group has lessons at all (lessons/occurrences.ts gives the others none). */
const holdsLessons = (g: Pick<GroupRow, 'deletedAt' | 'status'>) => !g.deletedAt && g.status !== 'COMPLETED' && g.status !== 'ARCHIVED';
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

@Injectable()
export class GroupsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly schedule: ScheduleService,
  ) {}

  // A TEACHER only ever sees the groups they're assigned to teach — every
  // other role sees the whole tenant. `role`/`userId` come from the JWT.
  async findAll(
    tenantId: string,
    role?: string,
    userId?: string,
    filters?: { courseId?: string; status?: string; branchId?: string },
  ) {
    let teacherId: string | undefined;
    if (role === 'TEACHER' && userId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.userId, userId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      teacherId = teacher?.id ?? '__none__';
    }

    const conditions = [
      eq(groups.tenantId, tenantId),
      isNull(groups.deletedAt),
    ];

    if (teacherId) {
      conditions.push(eq(groups.teacherId, teacherId));
    }
    if (filters?.courseId) {
      conditions.push(eq(groups.courseId, filters.courseId));
    }
    if (filters?.status) {
      conditions.push(eq(groups.status, filters.status as any));
    }
    if (filters?.branchId) {
      conditions.push(eq(groups.branchId, filters.branchId));
    }

    const rows = await this.db.query.groups.findMany({
      where: and(...conditions),
      with: { teacher: { columns: TEACHER_PUBLIC_COLUMNS }, branch: true, course: true },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });
    // Seats taken (same rule as capacity checks), for the list's
    // "students" and fill-status columns.
    const seats = rows.length === 0 ? [] : await this.db.select({ groupId: enrollments.groupId, n: sql<number>`count(*)::int` })
      .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
      .where(seatHeldWhere(inArray(enrollments.groupId, rows.map((g) => g.id))))
      .groupBy(enrollments.groupId);
    return rows.map((g) => ({ ...g, studentCount: seats.find((x) => x.groupId === g.id)?.n ?? 0 }));
  }

  trash(tenantId: string) {
    return this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenantId), isNotNull(groups.deletedAt)),
      orderBy: (g, { desc }) => desc(g.deletedAt),
    });
  }

  async findOne(tenantId: string, id: string, role?: string, userId?: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, id), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
      with: { teacher: { columns: TEACHER_PUBLIC_COLUMNS }, branch: true, course: true, enrollments: { with: { student: true } } },
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');

    if (role === 'TEACHER' && userId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.userId, userId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher || group.teacherId !== teacher.id) {
        throw new ForbiddenException("Sizga bu guruhga kirishga ruxsat berilmagan");
      }
    }

    return group;
  }

  /**
   * Whose lesson it was: the students who can be marked for a lesson of this
   * group on a date - the same rule attendance itself applies
   * (enrollments/membership.ts, lenient). So a past lesson lists those who
   * were in the group then, including someone who has left since
   * (`current: false`), and not someone who was on a break at the time.
   */
  async roster(tenantId: string, id: string, date: string, scheduleId: string | undefined, role?: string, userId?: string) {
    await this.findOne(tenantId, id, role, userId);
    if (!isDate(date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const [center] = await this.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const tz = isValidTimeZone(center?.tz) ? center.tz : DEFAULT_TIMEZONE;
    // The lesson's start, when the lesson is named and is this group's.
    const [lesson] = scheduleId
      ? await this.db.select({ startTime: schedules.startTime }).from(schedules).where(and(eq(schedules.id, scheduleId), eq(schedules.groupId, id), eq(schedules.tenantId, tenantId)))
      : [];
    const when = { date, at: lessonInstant(date, lesson?.startTime, tz) };
    const stays = staysByMember(await staysOf(this.db, tenantId, { groupIds: [id] }));
    const known = await this.db.select({ studentId: students.id, fullName: students.fullName, status: enrollments.status })
      .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.groupId, id), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
    return known
      .filter((s) => wasMember(stays.get(`${s.studentId}|${id}`) ?? [], when, tz, 'lenient'))
      .map((s) => ({ studentId: s.studentId, fullName: s.fullName, current: (stays.get(`${s.studentId}|${id}`) ?? []).some((p) => p.endedAt === null) }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /**
   * A group and its weekly lessons are written together, or not at all: the
   * center's timetable lock first, then the group row, its lessons, and the
   * same conflict check the timetable page makes (ScheduleService.findConflicts)
   * on what was just written. A clash rolls everything back.
   */
  async create(tenantId: string, userId: string, dto: CreateGroupDto, viewer?: ConflictViewer) {
    if (dto.courseId) {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, dto.courseId), eq(courses.tenantId, tenantId)),
      });
      if (!course) throw new NotFoundException('Kurs topilmadi');
    }

    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    const slot = this.lessonSlot(dto.scheduleDays, dto.startTime, dto.endTime);

    const group = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [row] = await tx
        .insert(groups)
        .values({
          tenantId,
          branchId: dto.branchId || null,
          courseId: dto.courseId || null,
          name: dto.name,
          subject: dto.subject,
          level: dto.level,
          teacherId: dto.teacherId || null,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          maxStudents: dto.maxStudents ?? 20,
          schedule: dto.schedule,
          scheduleDays: dto.scheduleDays,
          startTime: dto.startTime,
          endTime: slot?.end ?? dto.endTime,
          monthlyPrice: dto.monthlyPrice ?? 0,
          description: dto.description,
          durationMonths: dto.durationMonths,
          status: dto.status || 'ACTIVE',
          timetableManaged: !!slot,
        })
        .returning();
      await tx.insert(groupPriceHistory).values({ tenantId, groupId: row.id, monthlyPrice: row.monthlyPrice, effectiveFrom: row.createdAt });
      await this.ensureSubject(tx, tenantId, dto.subject);
      if (slot) {
        const made = await tx.insert(schedules).values(slot.days.map((day) => this.weeklyRow(tenantId, row, day, slot))).returning();
        if (holdsLessons(row)) await this.assertRowsFit(tx, tenantId, made, viewer);
      }
      return row;
    });
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'group', entityId: group.id, meta: { name: group.name } });
    return group;
  }

  // Lesson days + start/end from the group form, or null when the group
  // has no usable weekly schedule. End defaults to start + 90 minutes.
  private lessonSlot(scheduleDays?: string | null, startTime?: string | null, endTime?: string | null) {
    const days = isoWeekdaysOf(scheduleDays);
    if (days.length === 0 || !startTime) return null;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)) throw new BadRequestException("Dars vaqti noto'g'ri (HH:MM)");
    const end = endTime || addMinutes(startTime, DEFAULT_LESSON_MINUTES);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= startTime) {
      throw new BadRequestException("Dars tugash vaqti boshlanishidan keyin bo'lishi kerak");
    }
    return { days, start: startTime, end };
  }

  private weeklyRow(tenantId: string, group: GroupRow, day: number, slot: { start: string; end: string }) {
    return { tenantId, groupId: group.id, teacherId: group.teacherId, branchId: group.branchId, roomId: null, dayOfWeek: day, startTime: slot.start, endTime: slot.end, isRecurring: true };
  }

  private clash(conflicts: ScheduleConflict[], viewer: ConflictViewer | undefined, restore = false) {
    const shown = redactConflicts(conflicts, viewer);
    return new ConflictException({
      code: restore ? 'RESTORE_CONFLICT' : shown[0].type === 'TEACHER' ? 'TEACHER_SCHEDULE_CONFLICT' : 'SCHEDULE_CONFLICT',
      message: restore ? `Guruhni tiklab bo'lmaydi: ${shown[0].message}` : shown[0].message,
      conflicts: shown,
    });
  }

  /** The timetable page's own check, on rows this service wrote (inside the same transaction). */
  private async assertRowsFit(tx: Tx, tenantId: string, rows: LessonRow[], viewer: ConflictViewer | undefined, restore = false) {
    for (const r of rows) {
      const conflicts = await this.schedule.findConflicts(tenantId, {
        checkStudents: true, checkMakeups: true, groupId: r.groupId, teacherId: r.teacherId, roomId: r.roomId,
        dayOfWeek: r.dayOfWeek, date: r.date, startTime: r.startTime, endTime: r.endTime, excludeScheduleId: r.id,
      }, tx);
      if (conflicts.length) throw this.clash(conflicts, viewer, restore);
    }
  }

  /** Everything of the group that is a lesson from today on: weekly rows and coming one-offs. */
  private async lessonRows(tx: Tx, tenantId: string, groupId: string) {
    const today = await centerToday(tx, tenantId);
    const rows = await tx.select().from(schedules).where(and(eq(schedules.groupId, groupId), eq(schedules.tenantId, tenantId), ne(schedules.status, 'CANCELLED')));
    return rows.filter((r) => !r.date || r.date >= today);
  }

  /**
   * The group form changed something the timetable shows. The weekly rows
   * are changed in place - a row keeps its id, which is the lesson's
   * identity (lessons/occurrences.ts) - and only as far as the form
   * actually changed:
   *  - a day taken off the form: that weekday's rows go (their make-ups are
   *    released); a day added: one new row at the form's time;
   *  - a new time on the form: the rows that had the old form time move.
   *    A row given its own time on the timetable keeps it - the form holds
   *    one pair of hours and must not flatten the others by accident;
   *  - a new teacher or branch: the rows that had the group's old one.
   * A group from before timetable rows gets its rows now. Then the same
   * conflict check as the timetable page on every row written - and on
   * every lesson of the group when it comes back to life (status, start).
   */
  private async applyTimetable(tx: Tx, tenantId: string, before: GroupRow, after: GroupRow, userId: string, viewer?: ConflictViewer): Promise<MakeupReconcile> {
    const id = after.id;
    const slot = this.lessonSlot(after.scheduleDays, after.startTime, after.endTime);
    let oldSlot: ReturnType<GroupsService['lessonSlot']> = null;
    try {
      oldSlot = this.lessonSlot(before.scheduleDays, before.startTime, before.endTime);
    } catch {
      oldSlot = null;
    }
    const weekly = await tx.select().from(schedules).where(and(eq(schedules.groupId, id), eq(schedules.tenantId, tenantId), isNull(schedules.date)));
    const live = weekly.filter((r) => r.status !== 'CANCELLED');
    const written = new Map<string, LessonRow>();
    const gone: string[] = [];

    if (!before.timetableManaged && weekly.length === 0) {
      if (slot) for (const r of await tx.insert(schedules).values(slot.days.map((day) => this.weeklyRow(tenantId, after, day, slot))).returning()) written.set(r.id, r);
    } else if (!slot) {
      // No days or no start time on the form any more: the group has no weekly lessons.
      if (oldSlot) gone.push(...weekly.map((r) => r.id));
    } else {
      const beforeDays = isoWeekdaysOf(before.scheduleDays);
      if (!sameDays(beforeDays, slot.days)) {
        gone.push(...weekly.filter((r) => r.dayOfWeek && beforeDays.includes(r.dayOfWeek) && !slot.days.includes(r.dayOfWeek)).map((r) => r.id));
        const added = slot.days.filter((d) => !beforeDays.includes(d) && !live.some((r) => r.dayOfWeek === d));
        if (added.length) for (const r of await tx.insert(schedules).values(added.map((day) => this.weeklyRow(tenantId, after, day, slot))).returning()) written.set(r.id, r);
      }
      for (const r of live.filter((x) => !gone.includes(x.id))) {
        const set: Partial<LessonRow> = {};
        if (oldSlot && (slot.start !== oldSlot.start || slot.end !== oldSlot.end) && r.startTime === oldSlot.start && r.endTime === oldSlot.end) {
          set.startTime = slot.start;
          set.endTime = slot.end;
        }
        if (before.teacherId !== after.teacherId && (r.teacherId === before.teacherId || !r.teacherId)) set.teacherId = after.teacherId;
        if (before.branchId !== after.branchId && (r.branchId === before.branchId || !r.branchId)) set.branchId = after.branchId;
        if (Object.keys(set).length === 0) continue;
        const [row] = await tx.update(schedules).set({ ...set, updatedAt: new Date() }).where(eq(schedules.id, r.id)).returning();
        // A branch alone moves nobody: nothing to check.
        if (set.startTime || 'teacherId' in set) written.set(row.id, row);
      }
    }

    // Make-ups follow their lesson or are released - before the removed rows
    // go, while a booking still says which lesson it was for.
    const makeups = await reconcileGroupMakeups(tx, tenantId, [id], userId, {
      gone, note: !holdsLessons(after) ? 'GROUP_CLOSED' : gone.length ? 'LESSON_REMOVED' : 'LESSON_CHANGED',
    });
    if (gone.length) await tx.delete(schedules).where(and(inArray(schedules.id, gone), eq(schedules.tenantId, tenantId)));

    if (holdsLessons(after)) {
      const back = !holdsLessons(before) || String(before.startDate ?? '') !== String(after.startDate ?? '');
      await this.assertRowsFit(tx, tenantId, back ? await this.lessonRows(tx, tenantId, id) : [...written.values()], viewer);
    }
    if (slot && (written.size || gone.length)) await mirrorTimetableOnGroup(tx, tenantId, id);
    return makeups;
  }

  // Group subjects are free text; keep a matching row in the subjects
  // (directions) list so lead and placement forms can offer it.
  private async ensureSubject(db: Database | Tx, tenantId: string, name?: string | null) {
    const clean = name?.trim();
    if (!clean) return;
    await db.insert(subjects).values({ tenantId, name: clean }).onConflictDoNothing();
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateGroupDto, viewer?: ConflictViewer) {
    await this.findOne(tenantId, id);

    if (dto.courseId) {
      const course = await this.db.query.courses.findFirst({
        where: and(eq(courses.id, dto.courseId), eq(courses.tenantId, tenantId)),
      });
      if (!course) throw new NotFoundException('Kurs topilmadi');
    }

    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    // Only what the timetable shows needs the timetable lock: a new name or
    // description writes the group row and nothing else.
    const touchesLessons = [dto.scheduleDays, dto.startTime, dto.endTime, dto.teacherId, dto.branchId, dto.status, dto.startDate].some((v) => v !== undefined);

    const { group, current, makeups } = await this.db.transaction(async (tx) => {
      if (touchesLessons) await lockTimetable(tx, tenantId);
      // The group as it is now - under the lock when lessons are at stake.
      const [current] = await tx.select().from(groups).where(and(eq(groups.id, id), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (!current) throw new NotFoundException('Guruh topilmadi');
      await this.ensureSubject(tx, tenantId, dto.subject);

      const next = {
        scheduleDays: dto.scheduleDays !== undefined ? dto.scheduleDays : current.scheduleDays,
        startTime: dto.startTime !== undefined ? dto.startTime : current.startTime,
        endTime: dto.endTime !== undefined ? dto.endTime : dto.startTime !== undefined && dto.startTime !== current.startTime ? null : current.endTime,
      };
      const slot = this.lessonSlot(next.scheduleDays, next.startTime, next.endTime);

      const [group] = await tx
        .update(groups)
        .set({
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.subject ? { subject: dto.subject } : {}),
          ...(dto.level !== undefined ? { level: dto.level } : {}),
          ...(dto.courseId !== undefined ? { courseId: dto.courseId || null } : {}),
          ...(dto.teacherId !== undefined ? { teacherId: dto.teacherId || null } : {}),
          ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
          ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : undefined } : {}),
          ...(dto.maxStudents !== undefined ? { maxStudents: dto.maxStudents } : {}),
          ...(dto.schedule !== undefined ? { schedule: dto.schedule } : {}),
          ...(dto.scheduleDays !== undefined ? { scheduleDays: dto.scheduleDays } : {}),
          ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
          ...(dto.startTime !== undefined || dto.endTime !== undefined ? { endTime: slot?.end ?? next.endTime } : {}),
          ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.durationMonths !== undefined ? { durationMonths: dto.durationMonths } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)))
        .returning();

      // Lessons are touched only when something they depend on really
      // changed: sending the same days and hours again rebuilds nothing.
      const lessonsChanged =
        !sameDays(isoWeekdaysOf(current.scheduleDays), isoWeekdaysOf(group.scheduleDays)) || current.startTime !== group.startTime ||
        (current.endTime ?? null) !== (group.endTime ?? null) || current.teacherId !== group.teacherId || current.branchId !== group.branchId ||
        current.status !== group.status || String(current.startDate ?? '') !== String(group.startDate ?? '');
      const makeups = touchesLessons && lessonsChanged ? await this.applyTimetable(tx, tenantId, current, group, userId, viewer) : { moved: 0, released: 0 };

      // A new price applies from this month on; earlier months keep the old
      // one in debt and revenue figures.
      if (group.monthlyPrice !== current.monthlyPrice) {
        const [known] = await tx.select({ id: groupPriceHistory.id }).from(groupPriceHistory).where(eq(groupPriceHistory.groupId, id)).limit(1);
        if (!known) {
          // The old price is known to be the price until now; since when, nobody recorded.
          await tx.insert(groupPriceHistory).values({ tenantId, groupId: id, monthlyPrice: current.monthlyPrice, effectiveFrom: current.createdAt, source: 'ASSUMED' });
        }
        await tx.insert(groupPriceHistory).values({ tenantId, groupId: id, monthlyPrice: group.monthlyPrice });
      }
      const [saved] = await tx.select().from(groups).where(eq(groups.id, id));
      return { group: saved, current, makeups };
    });
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'group', entityId: id, meta: { ...dto, ...(makeups.moved + makeups.released ? { makeups } : {}) } });
    void current;
    return { ...group, makeups };
  }

  // What the group has cost over time, newest first, with where each entry
  // comes from.
  async priceHistory(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const rows = await this.db
      .select({
        id: groupPriceHistory.id, monthlyPrice: groupPriceHistory.monthlyPrice, effectiveFrom: groupPriceHistory.effectiveFrom,
        source: groupPriceHistory.source, note: groupPriceHistory.note, confirmedByUserId: groupPriceHistory.confirmedByUserId, createdAt: groupPriceHistory.createdAt,
      })
      .from(groupPriceHistory)
      .where(and(eq(groupPriceHistory.groupId, id), eq(groupPriceHistory.tenantId, tenantId)));
    return rows.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  }

  // Someone who knows says what the group cost from a past month on. This
  // is what turns an estimated month into a recorded one; it never edits or
  // removes earlier entries (a wrong one is corrected by confirming again),
  // and it does not touch invoices or payments.
  async confirmPrice(tenantId: string, userId: string, id: string, dto: { month: string; monthlyPrice: number; note?: string }) {
    const group = await this.findOne(tenantId, id);
    const [t] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const tz = isValidTimeZone(t?.timezone) ? t.timezone : DEFAULT_TIMEZONE;
    const now = zonedParts(new Date(), tz);
    const current = `${now.year}-${String(now.month).padStart(2, '0')}`;
    if (dto.month > current) throw new BadRequestException("Kelajak oyi uchun narxni tasdiqlab bo'lmaydi — guruh narxini o'zgartiring");
    const [y, m] = dto.month.split('-').map(Number);
    const [row] = await this.db.insert(groupPriceHistory).values({
      tenantId,
      groupId: id,
      monthlyPrice: dto.monthlyPrice,
      effectiveFrom: zonedTimeToUtc(y, m, 1, 0, 0, tz),
      source: 'RECORDED',
      confirmedByUserId: userId,
      note: dto.note?.trim().slice(0, 500) || null,
    }).returning();
    this.audit.log({
      tenantId, userId, action: 'update', entityType: 'group_price', entityId: id,
      meta: { groupName: group.name, month: dto.month, monthlyPrice: dto.monthlyPrice, note: row.note, historyId: row.id },
    });
    return this.priceHistory(tenantId, id);
  }

  /**
   * To the trash. The group has no lessons from now on, so the make-ups
   * booked into its coming lessons cannot happen: they are cancelled and
   * each credit comes back, once. What already happened - past and marked
   * make-ups, attendance - stays as history. `makeups` says how many.
   */
  async remove(tenantId: string, userId: string, id: string) {
    const makeups = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [row] = await tx.update(groups).set({ deletedAt: new Date() })
        .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId), isNull(groups.deletedAt))).returning({ id: groups.id });
      if (!row) throw new NotFoundException('Guruh topilmadi');
      return reconcileGroupMakeups(tx, tenantId, [id], userId, { note: 'GROUP_REMOVED' });
    });
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'group', entityId: id, meta: { releasedMakeups: makeups.released } });
    return { success: true, makeups };
  }

  /**
   * Back from the trash - if its lessons still fit: teacher, room, students
   * and make-ups are checked again with the timetable's own rule, and a
   * clash leaves the group in the trash. Make-ups released when it was
   * deleted stay cancelled; they are booked again by hand.
   */
  async restore(tenantId: string, userId: string, id: string, viewer?: ConflictViewer) {
    const group = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [row] = await tx.update(groups).set({ deletedAt: null })
        .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId))).returning();
      if (!row) throw new NotFoundException('Guruh topilmadi');
      if (holdsLessons(row)) await this.assertRowsFit(tx, tenantId, await this.lessonRows(tx, tenantId, id), viewer, true);
      return row;
    });
    this.audit.log({ tenantId, userId, action: 'restore', entityType: 'group', entityId: id });
    return group;
  }

  /**
   * Shown live in the group form before saving, from the same rule saving
   * itself applies (ScheduleService.findConflicts). The group's own lessons
   * are left out: the form is about to change them.
   *
   * Who may learn what: the group asked about must be one of the center's
   * (another center's or a made-up id is "not found" and tells nothing), a
   * teacher asks about their own groups only, and the answer goes through
   * redactConflicts before anything is put together - so a student is named
   * only to someone who both plans the timetable and may open the students
   * list, here as on the timetable page. Nobody else gets a name in any
   * field: they get the count.
   */
  async findScheduleConflicts(
    tenantId: string,
    teacherId: string,
    scheduleDays: string,
    startTime: string,
    excludeGroupId?: string,
    endTime?: string,
    viewer?: ConflictViewer,
  ) {
    if (excludeGroupId) {
      const [own] = await this.db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, excludeGroupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (!own) throw new NotFoundException('Guruh topilmadi');
    }
    // A teacher's question is about a group of their own (a new group is not theirs to plan).
    await assertTeacherGroups(this.db, tenantId, viewer, [excludeGroupId]);
    let slot: ReturnType<GroupsService['lessonSlot']>;
    try {
      slot = this.lessonSlot(scheduleDays, startTime, endTime);
    } catch {
      return [];
    }
    if (!slot || !teacherId) return [];
    // A teacher of another center (or none at all) has no lessons here to report.
    const [teacher] = await this.db.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.id, teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
    if (!teacher) return [];
    const seen = new Map<string, { id: string; name: string; scheduleDays: string | null; startTime: string | null }>();
    for (const day of slot.days) {
      const found = await this.schedule.findConflicts(tenantId, {
        groupId: excludeGroupId ?? '__new__', teacherId, dayOfWeek: day, startTime: slot.start, endTime: slot.end,
        checkStudents: !!excludeGroupId, checkMakeups: true,
      });
      // Redacted first; the answer is built only from what this viewer may read.
      for (const c of redactConflicts(found, viewer)) {
        if (c.type === 'GROUP' || (excludeGroupId && c.groupId === excludeGroupId)) continue;
        const key = c.groupId ?? `${c.type}:${c.date}:${c.startTime}`;
        if (!seen.has(key)) seen.set(key, { id: key, name: c.groupName ?? c.message, scheduleDays: null, startTime: `${c.startTime}-${c.endTime}` });
      }
    }
    return [...seen.values()];
  }
}
