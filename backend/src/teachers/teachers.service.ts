import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, teachers, users } from '../db/schema';
import { StaffService } from '../staff/staff.service';
import { CreateTeacherDto, TeacherAccountDto, UpdateTeacherDto } from './dto/teacher.dto';
import { AuditService } from '../audit/audit.service';
import { doubleSubmitSince, lockIdenticalCreate } from '../common/double-submit';

@Injectable()
export class TeachersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly staff: StaffService,
  ) {}

  // A linked user must be an active member of this center (the field used
  // to accept any user id, including another center's).
  private async assertMember(tenantId: string, userId: string) {
    const m = await this.db.query.organizationMemberships.findFirst({
      where: and(eq(organizationMemberships.userId, userId), eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.status, 'ACTIVE')),
    });
    if (!m) throw new BadRequestException("Foydalanuvchi bu markaz a'zosi emas");
  }

  findAll(tenantId: string) {
    return this.db.query.teachers.findMany({
      where: and(eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      with: { groups: true, user: { columns: { id: true, email: true } } },
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
      with: { groups: true, user: { columns: { id: true, email: true } } },
    });
    if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    return teacher;
  }

  // Gives the teacher a login (role TEACHER in this center) and links it,
  // so they see their own groups, lessons and pay.
  async createAccount(tenantId: string, actorId: string, id: string, dto: TeacherAccountDto) {
    const teacher = await this.findOne(tenantId, id);
    if (teacher.userId) throw new ConflictException("Bu o'qituvchida allaqachon akkaunt bor");
    const email = dto.email.trim().toLowerCase();
    let userId: string;
    try {
      const created = await this.staff.create(tenantId, { fullName: teacher.fullName, email, password: dto.password, role: 'TEACHER' });
      userId = created.id;
    } catch (e) {
      // Already a member of this center: link only if they are a teacher.
      if (!(e instanceof ConflictException)) throw e;
      const user = await this.db.query.users.findFirst({ where: eq(users.email, email) });
      const m = user && await this.db.query.organizationMemberships.findFirst({
        where: and(eq(organizationMemberships.userId, user.id), eq(organizationMemberships.tenantId, tenantId)),
      });
      if (!user || !m || m.role !== 'TEACHER') throw new ConflictException("Bu email boshqa xodimga tegishli");
      userId = user.id;
    }
    const other = await this.db.query.teachers.findFirst({
      where: and(eq(teachers.tenantId, tenantId), eq(teachers.userId, userId), isNull(teachers.deletedAt)),
    });
    if (other && other.id !== id) throw new ConflictException("Bu akkaunt boshqa o'qituvchiga bog'langan");
    await this.db.update(teachers).set({ userId, email: teacher.email ?? email, updatedAt: new Date() })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)));
    this.audit.log({ tenantId, userId: actorId, action: 'update', entityType: 'teacher', entityId: id, meta: { account: email } });
    return this.findOne(tenantId, id);
  }

  // Takes the login away: unlinks it and suspends the membership.
  async removeAccount(tenantId: string, actorId: string, id: string) {
    const teacher = await this.findOne(tenantId, id);
    if (!teacher.userId) return teacher;
    await this.db.update(organizationMemberships).set({ status: 'SUSPENDED', updatedAt: new Date() })
      .where(and(eq(organizationMemberships.userId, teacher.userId), eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.role, 'TEACHER')));
    await this.db.update(teachers).set({ userId: null, updatedAt: new Date() })
      .where(and(eq(teachers.id, id), eq(teachers.tenantId, tenantId)));
    this.audit.log({ tenantId, userId: actorId, action: 'update', entityType: 'teacher', entityId: id, meta: { account: null } });
    return this.findOne(tenantId, id);
  }

  async create(tenantId: string, userId: string, dto: CreateTeacherDto) {
    if (dto.userId) await this.assertMember(tenantId, dto.userId);
    // The same form sent twice (double click, a retry after a lost reply)
    // makes one teacher: the second request gets the first one's row.
    const { teacher, repeated } = await this.db.transaction(async (tx) => {
      await lockIdenticalCreate(tx, `teacher:${tenantId}:${dto.fullName}:${dto.phone ?? ''}:${dto.email ?? ''}`);
      const twin = await tx.query.teachers.findFirst({
        where: and(
          eq(teachers.tenantId, tenantId),
          eq(teachers.fullName, dto.fullName),
          dto.phone ? eq(teachers.phone, dto.phone) : isNull(teachers.phone),
          isNull(teachers.deletedAt),
          gte(teachers.createdAt, doubleSubmitSince()),
        ),
      });
      if (twin) return { teacher: twin, repeated: true };
      const [created] = await tx
        .insert(teachers)
        .values({
          tenantId,
          ...dto,
          birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        })
        .returning();
      return { teacher: created, repeated: false };
    });
    if (repeated) return teacher;
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'teacher', entityId: teacher.id, meta: { fullName: teacher.fullName } });
    return teacher;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateTeacherDto) {
    await this.findOne(tenantId, id);
    if (dto.userId) await this.assertMember(tenantId, dto.userId);
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
