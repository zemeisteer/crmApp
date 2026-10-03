import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, teachers, users } from '../db/schema';
import { StaffService } from '../staff/staff.service';
import { CreateTeacherDto, TeacherAccountDto, UpdateTeacherDto } from './dto/teacher.dto';
import { AuditService } from '../audit/audit.service';
import { blankToNull, idempotencyKey, lockIdempotencyKey, requestHash } from '../common/create-idempotency';
import { isUniqueViolation } from '../common/db-errors';

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

  async create(tenantId: string, userId: string, dto: CreateTeacherDto, rawKey?: string) {
    if (dto.userId) await this.assertMember(tenantId, dto.userId);
    // Retry protection (see common/create-idempotency): the same key with
    // the same form returns the teacher made the first time; the same key
    // with a different form is a conflict.
    const key = idempotencyKey(rawKey);
    const hash = key ? requestHash('teacher.create', dto) : null;
    const replay = async (db: Pick<Database, 'select'>) => {
      if (!key) return null;
      const [prior] = await db
        .select()
        .from(teachers)
        .where(and(eq(teachers.tenantId, tenantId), eq(teachers.idempotencyKey, key)));
      if (!prior) return null;
      if (prior.requestHash !== hash) throw new ConflictException("Bu Idempotency-Key boshqa ma'lumotli o'qituvchi uchun ishlatilgan");
      return prior;
    };
    let result: { teacher: typeof teachers.$inferSelect; replayed: boolean };
    try {
      result = await this.db.transaction(async (tx) => {
        if (key) {
          await lockIdempotencyKey(tx, 'teacher.create', tenantId, key);
          const prior = await replay(tx);
          if (prior) return { teacher: prior, replayed: true };
        }
        const [created] = await tx
          .insert(teachers)
          .values({
            tenantId,
            ...dto,
            fullName: dto.fullName.trim(),
            phone: blankToNull(dto.phone),
            email: blankToNull(dto.email),
            subject: blankToNull(dto.subject),
            birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            idempotencyKey: key,
            requestHash: hash,
          })
          .returning();
        return { teacher: created, replayed: false };
      });
    } catch (err) {
      if (key && isUniqueViolation(err, 'teachers_tenant_idem_uniq')) {
        const prior = await replay(this.db);
        if (prior) return publicRow(prior);
      }
      throw err;
    }
    const teacher = publicRow(result.teacher);
    if (result.replayed) return teacher;
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

// The retry bookkeeping stays on the server.
function publicRow<T extends { idempotencyKey?: string | null; requestHash?: string | null }>(row: T) {
  const { idempotencyKey: _k, requestHash: _h, ...rest } = row;
  return rest;
}
