import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groups, teachers } from '../db/schema';
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
  async findAll(tenantId: string, role?: string, userId?: string) {
    let teacherId: string | undefined;
    if (role === 'TEACHER' && userId) {
      const teacher = await this.db.query.teachers.findFirst({ where: eq(teachers.userId, userId) });
      teacherId = teacher?.id ?? '__none__';
    }
    return this.db.query.groups.findMany({
      where: and(
        eq(groups.tenantId, tenantId),
        isNull(groups.deletedAt),
        teacherId ? eq(groups.teacherId, teacherId) : undefined,
      ),
      with: { teacher: true, branch: true },
      orderBy: (g, { desc }) => desc(g.createdAt),
    });
  }

  trash(tenantId: string) {
    return this.db.query.groups.findMany({
      where: and(eq(groups.tenantId, tenantId), isNotNull(groups.deletedAt)),
      orderBy: (g, { desc }) => desc(g.deletedAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, id), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
      with: { teacher: true, branch: true, enrollments: { with: { student: true } } },
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');
    return group;
  }

  async create(tenantId: string, userId: string, dto: CreateGroupDto) {
    const [group] = await this.db
      .insert(groups)
      .values({
        tenantId,
        branchId: dto.branchId,
        name: dto.name,
        subject: dto.subject,
        level: dto.level,
        teacherId: dto.teacherId,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        maxStudents: dto.maxStudents ?? 20,
        schedule: dto.schedule,
        scheduleDays: dto.scheduleDays,
        startTime: dto.startTime,
        monthlyPrice: dto.monthlyPrice ?? 0,
        description: dto.description,
        durationMonths: dto.durationMonths,
      })
      .returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'group', entityId: group.id, meta: { name: group.name } });
    return group;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateGroupDto) {
    await this.findOne(tenantId, id);
    const [group] = await this.db
      .update(groups)
      .set({
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
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
}
