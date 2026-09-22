import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { teachers } from '../db/schema';
import { CreateTeacherDto, UpdateTeacherDto } from './dto/teacher.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TeachersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  findAll(tenantId: string) {
    return this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      with: { groups: true },
      orderBy: (t, { desc }) => desc(t.createdAt),
    });
  }

  trash(tenantId: string) {
    return this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenantId), isNotNull(teachers.deletedAt)),
      orderBy: (t, { desc }) => desc(t.deletedAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const teacher = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.id, id), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      with: { groups: true },
    });
    if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    return teacher;
  }

  async create(tenantId: string, userId: string, dto: CreateTeacherDto) {
    const [teacher] = await this.db
      .insert(teachers)
      .values({
        tenantId,
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      })
      .returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'teacher', entityId: teacher.id, meta: { fullName: teacher.fullName } });
    return teacher;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateTeacherDto) {
    await this.findOne(tenantId, id);
    const [teacher] = await this.db
      .update(teachers)
      .set({
        ...dto,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)))
      .returning();
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'teacher', entityId: id, meta: dto });
    return teacher;
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db
      .update(teachers)
      .set({ deletedAt: new Date() })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)));
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'teacher', entityId: id });
    return { success: true };
  }

  async restore(tenantId: string, userId: string, id: string) {
    const [teacher] = await this.db
      .update(teachers)
      .set({ deletedAt: null })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)))
      .returning();
    if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    this.audit.log({ tenantId, userId, action: 'restore', entityType: 'teacher', entityId: id });
    return teacher;
  }
}
