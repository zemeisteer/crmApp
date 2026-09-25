import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull, inArray, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, enrollments, groups, organizationMemberships, studentGuardians, students, users } from '../db/schema';
import { CreateStudentDto, LinkGuardianDto, UpdateStudentDto } from './dto/student.dto';
import { AuditService } from '../audit/audit.service';
import { countOccupiedSeats } from '../common/seats';
import { studentIdsInGroups, teacherGroupIds } from '../common/teacher-scope';
import { WebhooksService } from '../webhooks/webhooks.service';

@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
  ) {}

  // Guardian user rows are loaded with safe columns only: `user: true` used to
  // return password/reset-token hashes and the 2FA secret to the client.
  async findAll(tenantId: string, filters?: { status?: string; branchId?: string }, viewer?: { role?: string; userId?: string }) {
    const conditions = [eq(students.tenantId, tenantId), isNull(students.deletedAt)];
    // Teachers see only students actively enrolled in their own groups.
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope) {
      const ids = await studentIdsInGroups(this.db, scope);
      if (ids.length === 0) return [];
      conditions.push(inArray(students.id, ids));
    }
    if (filters?.status) conditions.push(eq(students.status, filters.status as any));
    if (filters?.branchId) conditions.push(eq(students.branchId, filters.branchId));

    return this.db.query.students.findMany({
      where: and(...conditions),
      with: {
        enrollments: { with: { group: true } },
        guardians: { with: { user: { columns: { id: true, fullName: true, email: true, phone: true } } } },
        branch: true,
      },
      orderBy: (s, { desc }) => desc(s.createdAt),
    });
  }

  trash(tenantId: string) {
    return this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNotNull(students.deletedAt)),
      orderBy: (s, { desc }) => desc(s.deletedAt),
    });
  }

  async findOne(tenantId: string, id: string, viewer?: { role?: string; userId?: string }) {
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope && !(await studentIdsInGroups(this.db, scope)).includes(id)) {
      // Same answer as a missing student: nothing about others leaks.
      throw new NotFoundException("O'quvchi topilmadi");
    }
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, id), eq(students.tenantId, tenantId), isNull(students.deletedAt)),
      with: {
        enrollments: { with: { group: true } },
        guardians: { with: { user: { columns: { id: true, fullName: true, email: true, phone: true } } } },
        branch: true,
        payments: true,
      },
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    // Payment history is finance data, not part of a teacher's view.
    if (scope) return { ...student, payments: [] };
    return student;
  }

  async create(tenantId: string, userId: string, dto: CreateStudentDto) {
    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    const groupIds = dto.groupIds && dto.groupIds.length > 0 ? dto.groupIds : dto.groupId ? [dto.groupId] : [];
    const student = await this.db.transaction(async (tx) => {
      const [student] = await tx
        .insert(students)
        .values({
          tenantId,
          branchId: dto.branchId || null,
          fullName: dto.fullName,
          gender: dto.gender as any,
          phone: dto.phone,
          parentPhone: dto.parentPhone,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          address: dto.address,
          telegramUsername: dto.telegramUsername,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          status: dto.status || 'ACTIVE',
          notes: dto.notes || null,
          avatarUrl: dto.avatarUrl || null,
        })
        .returning();

      if (groupIds.length > 0) {
        const validGroups = await tx.query.groups.findMany({
          where: and(eq(groups.tenantId, tenantId), inArray(groups.id, groupIds), isNull(groups.deletedAt)),
        });
        const validGroupIds = validGroups.map((g) => g.id);
        // A full group rolls back the whole create, student included.
        for (const groupId of validGroupIds) await this.lockGroupWithCapacity(tx, tenantId, groupId);
        if (validGroupIds.length > 0) {
          await tx
            .insert(enrollments)
            .values(
              validGroupIds.map((groupId) => ({
                tenantId,
                studentId: student.id,
                groupId,
                status: 'ACTIVE' as const,
                joinedAt: new Date(),
              })),
            )
            .onConflictDoNothing();
        }
      }
      return student;
    });
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'student', entityId: student.id, meta: { fullName: student.fullName } });
    void this.webhooks.dispatch(tenantId, 'student.created', student);
    return student;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(tenantId, id);

    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    const [student] = await this.db
      .update(students)
      .set({
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
        ...(dto.gender !== undefined ? { gender: dto.gender as any } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.parentPhone !== undefined ? { parentPhone: dto.parentPhone } : {}),
        ...(dto.birthDate !== undefined ? { birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.telegramUsername !== undefined ? { telegramUsername: dto.telegramUsername } : {}),
        ...(dto.startDate !== undefined ? { startDate: dto.startDate ? new Date(dto.startDate) : undefined } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes || null } : {}),
        ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl || null } : {}),
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
    return this.db.transaction(async (tx) => {
      const existing = await tx.query.enrollments.findFirst({
        where: and(
          eq(enrollments.studentId, studentId),
          eq(enrollments.groupId, groupId),
        ),
      });

      if (existing && existing.status === 'ACTIVE') {
        // Checked before the capacity lock so a full group still reports
        // "already enrolled" for a student who is in it.
        await this.lockGroupWithCapacity(tx, tenantId, groupId, { skipCapacity: true });
        throw new BadRequestException("O'quvchi allaqachon ushbu guruhda faol ro'yxatdan o'tgan");
      }
      await this.lockGroupWithCapacity(tx, tenantId, groupId);

      if (existing) {
        const [reactivated] = await tx
          .update(enrollments)
          .set({
            tenantId,
            status: 'ACTIVE',
            joinedAt: new Date(),
            leftAt: null,
          })
          .where(eq(enrollments.id, existing.id))
          .returning();
        return { success: true, enrollment: reactivated };
      }

      const [created] = await tx
        .insert(enrollments)
        .values({
          tenantId,
          studentId,
          groupId,
          status: 'ACTIVE',
          joinedAt: new Date(),
        })
        .returning();

      return { success: true, enrollment: created };
    });
  }

  // Locks the group row for the rest of the transaction, so concurrent
  // enrollments into the same group are serialized, then enforces
  // groups.maxStudents against the ACTIVE enrollments.
  private async lockGroupWithCapacity(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    tenantId: string,
    groupId: string,
    opts: { skipCapacity?: boolean } = {},
  ) {
    const [group] = await tx
      .select()
      .from(groups)
      .where(and(eq(groups.id, groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)))
      .for('update');
    if (!group) throw new NotFoundException('Guruh topilmadi');
    if (opts.skipCapacity) return group;
    const active = await countOccupiedSeats(tx, groupId);
    if (active >= group.maxStudents) {
      throw new ConflictException({
        code: 'GROUP_FULL',
        message: `"${group.name}" guruhida bo'sh joy yo'q (${active}/${group.maxStudents})`,
      });
    }
    return group;
  }

  async unenroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    const existing = await this.db.query.enrollments.findFirst({
      where: and(
        eq(enrollments.studentId, studentId),
        eq(enrollments.groupId, groupId),
      ),
    });

    if (!existing) {
      throw new NotFoundException("Guruhda a'zolik topilmadi");
    }

    const [updated] = await this.db
      .update(enrollments)
      .set({
        status: 'CANCELLED',
        leftAt: new Date(),
      })
      .where(eq(enrollments.id, existing.id))
      .returning();

    return { success: true, enrollment: updated };
  }

  // Guardians management
  async getGuardians(tenantId: string, studentId: string, viewer?: { role?: string; userId?: string }) {
    await this.findOne(tenantId, studentId, viewer);
    return this.db.query.studentGuardians.findMany({
      where: and(
        eq(studentGuardians.tenantId, tenantId),
        eq(studentGuardians.studentId, studentId),
      ),
      with: { user: { columns: { id: true, fullName: true, email: true, phone: true } } },
    });
  }

  async linkGuardian(tenantId: string, studentId: string, dto: LinkGuardianDto) {
    await this.findOne(tenantId, studentId);

    let targetUserId = dto.userId;
    if (!targetUserId && dto.phone) {
      const cleanPhone = dto.phone.trim();
      const user = await this.db.query.users.findFirst({
        where: eq(users.phone, cleanPhone),
      });

      if (!user) {
        throw new NotFoundException(`Ushbu telefon raqamli (${cleanPhone}) foydalanuvchi tizimda topilmadi`);
      }
      targetUserId = user.id;
    }

    if (!targetUserId) {
      throw new BadRequestException("Ota-ona foydalanuvchi IDsi yoki telefon raqami ko'rsatilishi shart");
    }

    const guardianUser = await this.db.query.users.findFirst({
      where: eq(users.id, targetUserId),
    });
    if (!guardianUser) {
      throw new NotFoundException('Foydalanuvchi topilmadi');
    }

    const membership = await this.db.query.organizationMemberships.findFirst({
      where: and(
        eq(organizationMemberships.tenantId, tenantId),
        eq(organizationMemberships.userId, targetUserId),
      ),
    });
    if (!membership) {
      await this.db.insert(organizationMemberships).values({
        tenantId,
        userId: targetUserId,
        role: 'PARENT',
        status: 'ACTIVE',
      });
    }

    const existingLink = await this.db.query.studentGuardians.findFirst({
      where: and(
        eq(studentGuardians.tenantId, tenantId),
        eq(studentGuardians.studentId, studentId),
        eq(studentGuardians.userId, targetUserId),
      ),
    });

    if (existingLink) {
      const [updated] = await this.db
        .update(studentGuardians)
        .set({
          relationship: dto.relationship || existingLink.relationship,
          isPrimary: dto.isPrimary !== undefined ? dto.isPrimary : existingLink.isPrimary,
        })
        .where(eq(studentGuardians.id, existingLink.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(studentGuardians)
      .values({
        tenantId,
        studentId,
        userId: targetUserId,
        relationship: dto.relationship || 'Guardian',
        isPrimary: dto.isPrimary ?? false,
      })
      .returning();

    return created;
  }

  async unlinkGuardian(tenantId: string, studentId: string, guardianIdOrUserId: string) {
    await this.findOne(tenantId, studentId);
    await this.db
      .delete(studentGuardians)
      .where(
        and(
          eq(studentGuardians.tenantId, tenantId),
          eq(studentGuardians.studentId, studentId),
          or(
            eq(studentGuardians.id, guardianIdOrUserId),
            eq(studentGuardians.userId, guardianIdOrUserId),
          ),
        ),
      );
    return { success: true };
  }
}
