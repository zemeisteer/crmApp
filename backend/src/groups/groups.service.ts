import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, ne } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, courses, groups, schedules, subjects, teachers } from '../db/schema';
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

    return this.db.query.groups.findMany({
      where: and(...conditions),
      with: { teacher: true, branch: true, course: true },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });
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
      with: { teacher: true, branch: true, course: true, enrollments: { with: { student: true } } },
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
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'group', entityId: id, meta: dto });
    return group;
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
