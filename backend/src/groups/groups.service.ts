import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, courses, enrollments, groupPriceHistory, groups, schedules, students, subjects, teachers, tenants } from '../db/schema';
import { TEACHER_PUBLIC_COLUMNS } from '../common/teacher-columns';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { seatHeldWhere } from '../common/seats';
import { addMinutes, DEFAULT_LESSON_MINUTES, isoWeekdaysOf } from '../common/weekdays';
import { isOverlapping } from '../schedule/schedule.service';
import { CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class GroupsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
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

  async create(tenantId: string, userId: string, dto: CreateGroupDto) {
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
    if (slot) await this.assertTeacherFree(tenantId, null, dto.teacherId ?? null, slot);

    const [group] = await this.db
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
      })
      .returning();
    await this.db.insert(groupPriceHistory).values({ tenantId, groupId: group.id, monthlyPrice: group.monthlyPrice, effectiveFrom: group.createdAt });
    await this.ensureSubject(tenantId, dto.subject);
    await this.syncWeeklyLessons(tenantId, group);
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

  // Weekly lessons of this teacher in other groups that overlap the slot.
  private async teacherClashes(tenantId: string, groupId: string | null, teacherId: string, slot: { days: number[]; start: string; end: string }) {
    const rows = await this.db
      .select({ id: schedules.id, dayOfWeek: schedules.dayOfWeek, startTime: schedules.startTime, endTime: schedules.endTime, groupId: groups.id, groupName: groups.name })
      .from(schedules)
      .innerJoin(groups, eq(groups.id, schedules.groupId))
      .where(and(
        eq(schedules.tenantId, tenantId),
        eq(schedules.teacherId, teacherId),
        eq(schedules.isRecurring, true),
        isNull(schedules.date),
        ne(schedules.status, 'CANCELLED'),
        isNull(groups.deletedAt),
        inArray(schedules.dayOfWeek, slot.days),
        ...(groupId ? [ne(schedules.groupId, groupId)] : []),
      ));
    return rows.filter((r) => isOverlapping(slot.start, slot.end, r.startTime, r.endTime));
  }

  private async assertTeacherFree(tenantId: string, groupId: string | null, teacherId: string | null, slot: { days: number[]; start: string; end: string }) {
    if (!teacherId) return;
    const clashes = await this.teacherClashes(tenantId, groupId, teacherId, slot);
    if (clashes.length === 0) return;
    const c = clashes[0];
    throw new ConflictException({
      code: 'TEACHER_SCHEDULE_CONFLICT',
      message: `O'qituvchi bu vaqtda "${c.groupName}" guruhida dars beradi (${c.startTime}-${c.endTime})`,
      conflicts: clashes.map((x) => ({ groupId: x.groupId, groupName: x.groupName, dayOfWeek: x.dayOfWeek, startTime: x.startTime, endTime: x.endTime })),
    });
  }

  // The timetable's weekly rows mirror the group form: one row per lesson
  // day. Rebuilt on every change; a room set on the timetable is kept for
  // the same weekday.
  private async syncWeeklyLessons(tenantId: string, group: typeof groups.$inferSelect) {
    const slot = group.deletedAt ? null : this.lessonSlot(group.scheduleDays, group.startTime, group.endTime);
    await this.db.transaction(async (tx) => {
      const old = await tx.select({ dayOfWeek: schedules.dayOfWeek, roomId: schedules.roomId })
        .from(schedules)
        .where(and(eq(schedules.groupId, group.id), eq(schedules.tenantId, tenantId), eq(schedules.isRecurring, true), isNull(schedules.date)));
      await tx.delete(schedules)
        .where(and(eq(schedules.groupId, group.id), eq(schedules.tenantId, tenantId), eq(schedules.isRecurring, true), isNull(schedules.date)));
      if (!slot) return;
      await tx.insert(schedules).values(slot.days.map((day) => ({
        tenantId,
        groupId: group.id,
        teacherId: group.teacherId,
        branchId: group.branchId,
        roomId: old.find((o) => o.dayOfWeek === day)?.roomId ?? null,
        dayOfWeek: day,
        startTime: slot.start,
        endTime: slot.end,
        isRecurring: true,
      })));
    });
  }

  // Group subjects are free text; keep a matching row in the subjects
  // (directions) list so lead and placement forms can offer it.
  private async ensureSubject(tenantId: string, name?: string | null) {
    const clean = name?.trim();
    if (!clean) return;
    await this.db.insert(subjects).values({ tenantId, name: clean }).onConflictDoNothing();
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateGroupDto) {
    const current = await this.findOne(tenantId, id);
    await this.ensureSubject(tenantId, dto.subject);

    // The lesson slot after this update; checked for teacher clashes only
    // when days, times or the teacher actually change.
    const next = {
      scheduleDays: dto.scheduleDays !== undefined ? dto.scheduleDays : current.scheduleDays,
      startTime: dto.startTime !== undefined ? dto.startTime : current.startTime,
      endTime: dto.endTime !== undefined ? dto.endTime : dto.startTime !== undefined ? null : current.endTime,
      teacherId: dto.teacherId !== undefined ? dto.teacherId || null : current.teacherId,
    };
    const slot = this.lessonSlot(next.scheduleDays, next.startTime, next.endTime);
    const slotChanged =
      next.scheduleDays !== current.scheduleDays || next.startTime !== current.startTime ||
      (slot?.end ?? null) !== (current.endTime ?? null) || next.teacherId !== current.teacherId;
    if (slot && slotChanged) await this.assertTeacherFree(tenantId, id, next.teacherId, slot);

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

    const [group] = await this.db
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
    if (slotChanged || dto.branchId !== undefined) await this.syncWeeklyLessons(tenantId, group);
    // A new price applies from this month on; earlier months keep the old
    // one in debt and revenue figures.
    if (group.monthlyPrice !== current.monthlyPrice) {
      const [known] = await this.db.select({ id: groupPriceHistory.id }).from(groupPriceHistory).where(eq(groupPriceHistory.groupId, id)).limit(1);
      if (!known) {
        // The old price is known to be the price until now; since when, nobody recorded.
        await this.db.insert(groupPriceHistory).values({ tenantId, groupId: id, monthlyPrice: current.monthlyPrice, effectiveFrom: current.createdAt, source: 'ASSUMED' });
      }
      await this.db.insert(groupPriceHistory).values({ tenantId, groupId: id, monthlyPrice: group.monthlyPrice });
    }
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'group', entityId: id, meta: dto });
    return group;
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

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db
      .update(groups)
      .set({ deletedAt: new Date() })
      .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)));
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'group', entityId: id });
    return { success: true };
  }

  async restore(tenantId: string, userId: string, id: string) {
    const [group] = await this.db
      .update(groups)
      .set({ deletedAt: null })
      .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)))
      .returning();
    if (!group) throw new NotFoundException('Guruh topilmadi');
    this.audit.log({ tenantId, userId, action: 'restore', entityType: 'group', entityId: id });
    return group;
  }

  // Shown live in the group form before saving; saving itself refuses a
  // clash (see assertTeacherFree).
  async findScheduleConflicts(
    tenantId: string,
    teacherId: string,
    scheduleDays: string,
    startTime: string,
    excludeGroupId?: string,
    endTime?: string,
  ) {
    let slot: ReturnType<GroupsService['lessonSlot']>;
    try {
      slot = this.lessonSlot(scheduleDays, startTime, endTime);
    } catch {
      return [];
    }
    if (!slot || !teacherId) return [];
    const clashes = await this.teacherClashes(tenantId, excludeGroupId ?? null, teacherId, slot);
    const seen = new Map<string, { id: string; name: string; scheduleDays: string | null; startTime: string | null }>();
    for (const c of clashes) {
      if (!seen.has(c.groupId)) seen.set(c.groupId, { id: c.groupId, name: c.groupName, scheduleDays: null, startTime: `${c.startTime}-${c.endTime}` });
    }
    return [...seen.values()];
  }
}
