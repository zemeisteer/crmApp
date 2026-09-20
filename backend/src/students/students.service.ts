import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { students, enrollments } from '../db/schema';
import { CreateStudentDto, UpdateStudentDto } from './dto/student.dto';
import { AuditService } from '../audit/audit.service';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  findAll(tenantId: string) {
    return this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNull(students.deletedAt)),
      with: { enrollments: { with: { group: true } } },
      orderBy: (s, { desc }) => desc(s.createdAt),
    });
  }

  trash(tenantId: string) {
    return this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNotNull(students.deletedAt)),
      orderBy: (s, { desc }) => desc(s.deletedAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, id), eq(students.tenantId, tenantId), isNull(students.deletedAt)),
      with: { enrollments: { with: { group: true } }, payments: true },
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    return student;
  }

  async create(tenantId: string, userId: string, dto: CreateStudentDto) {
    const [student] = await this.db
      .insert(students)
      .values({
        tenantId,
        fullName: dto.fullName,
        gender: dto.gender as any,
        phone: dto.phone,
        parentPhone: dto.parentPhone,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        address: dto.address,
        telegramUsername: dto.telegramUsername,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      })
      .returning();

    const groupIds = dto.groupIds && dto.groupIds.length > 0 ? dto.groupIds : dto.groupId ? [dto.groupId] : [];
    if (groupIds.length > 0) {
      await this.db
        .insert(enrollments)
        .values(groupIds.map((groupId) => ({ studentId: student.id, groupId })))
        .onConflictDoNothing();
    }
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'student', entityId: student.id, meta: { fullName: student.fullName } });
    void this.webhooks.dispatch(tenantId, 'student.created', student);
    return student;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(tenantId, id);
    const [student] = await this.db
      .update(students)
      .set({
        ...dto,
        gender: dto.gender as any,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(students.id, id), eq(students.tenantId, tenantId)))
      .returning();
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'student', entityId: id, meta: dto });
    return student;
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db
      .update(students)
      .set({ deletedAt: new Date() })
      .where(and(eq(students.id, id), eq(students.tenantId, tenantId)));
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'student', entityId: id });
    return { success: true };
  }

  async restore(tenantId: string, userId: string, id: string) {
    const [student] = await this.db
      .update(students)
      .set({ deletedAt: null })
      .where(and(eq(students.id, id), eq(students.tenantId, tenantId)))
      .returning();
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    this.audit.log({ tenantId, userId, action: 'restore', entityType: 'student', entityId: id });
    return student;
  }

  async enroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    await this.db.insert(enrollments).values({ studentId, groupId }).onConflictDoNothing();
    return { success: true };
  }

  async unenroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    await this.db
      .delete(enrollments)
      .where(and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, groupId)));
    return { success: true };
  }
}
