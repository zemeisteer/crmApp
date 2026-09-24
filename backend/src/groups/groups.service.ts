import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, courses, groups, teachers } from '../db/schema';
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
        monthlyPrice: dto.monthlyPrice ?? 0,
        description: dto.description,
        durationMonths: dto.durationMonths,
        status: dto.status || 'ACTIVE',
      })
      .returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'group', entityId: group.id, meta: { name: group.name } });
    return group;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateGroupDto) {
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
        ...(dto.monthlyPrice !== undefined ? { monthlyPrice: dto.monthlyPrice } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.durationMonths !== undefined ? { durationMonths: dto.durationMonths } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(groups.id, id), eq(groups.tenantId, tenantId)))
      .returning();
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

  // Advisory-only: a teacher can't physically teach two groups at the same
  // day+time, but groups don't carry a lesson duration, so this can only
  // compare exact day/time matches — it's surfaced to the admin as a
  // warning, never blocks saving.
  async findScheduleConflicts(
    tenantId: string,
    teacherId: string,
    scheduleDays: string,
    startTime: string,
    excludeGroupId?: string,
  ) {
    const days = new Set(
      scheduleDays
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean),
    );
    if (days.size === 0 || !startTime) return [];

    const candidates = await this.db.query.groups.findMany({
      where: and(
        eq(groups.tenantId, tenantId),
        eq(groups.teacherId, teacherId),
        eq(groups.startTime, startTime),
        isNull(groups.deletedAt),
      ),
    });

    return candidates
      .filter((g) => g.id !== excludeGroupId)
      .filter((g) => (g.scheduleDays ?? '').split(',').some((d) => days.has(d.trim())))
      .map((g) => ({ id: g.id, name: g.name, scheduleDays: g.scheduleDays, startTime: g.startTime }));
  }
}
