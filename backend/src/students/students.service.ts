import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, eq, ilike, isNotNull, isNull, inArray, or } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, enrollmentPeriods, enrollments, genderEnum, groups, leads, organizationMemberships, studentGuardians, studentPortalPins, students, users } from '../db/schema';
import { randomInt } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { CreateStudentDto, LinkGuardianDto, UpdateStudentDto } from './dto/student.dto';
import { AuditService } from '../audit/audit.service';
import { blankToNull, idempotencyKey, lockIdempotencyKey, requestHash } from '../common/create-idempotency';
import { isUniqueViolation } from '../common/db-errors';
import { countOccupiedSeats } from '../common/seats';
import { assertNoStudentTimeClash } from '../common/student-schedule';
import { studentIdsInGroups, teacherGroupIds } from '../common/teacher-scope';
import { containsPattern, enrolledInDirection, enrolledInGroup, enrolledInGroupNamed, queryText } from '../common/list-filters';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { closeStays, openStay, reopenStays } from '../enrollments/membership';
import { lockStudents } from '../common/student-lock';

@Injectable()
export class StudentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly webhooks: WebhooksService,
    private readonly customFields: CustomFieldsService,
  ) {}

  // Guardian user rows are loaded with safe columns only: `user: true` used to
  // return password/reset-token hashes and the 2FA secret to the client.
  /**
   * The student list. Without `page` the whole list (as before); with `page`
   * one page of `pageSize` (default 50, max 200) and the total, so a large
   * center does not send thousands of rows. All filters run on the server
   * either way:
   * - `search`: name, phone, parent phone, or the name or subject of a group
   *   the student is enrolled in;
   * - `groupId`: enrolled in that group (a group of another center: nothing);
   * - `direction`: enrolled in a group whose subject matches it (the
   *   page's matchesSubject rule, see common/list-filters);
   * - `gender`: MALE or FEMALE (anything else is a 400).
   * Enrollments of any status count, as the list's "groups" column shows them.
   */
  async findAll(
    tenantId: string,
    filters?: { status?: string; branchId?: string; search?: unknown; groupId?: unknown; direction?: unknown; gender?: unknown; ids?: unknown; page?: number; pageSize?: number },
    viewer?: { role?: string; userId?: string },
  ) {
    const term = queryText(filters?.search, 'search', 1000)?.slice(0, 80);
    // A list of ids narrows the answer; it never widens it (the center and
    // the teacher's own groups still apply below).
    // (An empty list is "none of them", not "no filter".)
    const idList = filters?.ids === undefined ? undefined : (queryText(filters.ids, 'ids', 200 * 65) ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (idList && idList.length > 200) throw new BadRequestException("Ko'pi bilan 200 ta id");
    const groupId = queryText(filters?.groupId, 'groupId', 64);
    const direction = queryText(filters?.direction, 'direction', 100);
    const gender = queryText(filters?.gender, 'gender', 10);
    if (gender && !(genderEnum.enumValues as readonly string[]).includes(gender)) throw new BadRequestException("Jins noto'g'ri");
    const pageSize = Math.min(Math.max(filters?.pageSize ?? 50, 1), 200);
    const page = Math.max(filters?.page ?? 1, 1);

    const conditions = [eq(students.tenantId, tenantId), isNull(students.deletedAt)];
    // Teachers see only students actively enrolled in their own groups.
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope) {
      const ids = await studentIdsInGroups(this.db, scope);
      if (ids.length === 0) return filters?.page ? { items: [], total: 0, page, pageSize } : [];
      conditions.push(inArray(students.id, ids));
    }
    if (idList) {
      if (idList.length === 0) return filters?.page ? { items: [], total: 0, page, pageSize } : [];
      conditions.push(inArray(students.id, idList));
    }
    if (filters?.status) conditions.push(eq(students.status, filters.status as any));
    if (filters?.branchId) conditions.push(eq(students.branchId, filters.branchId));
    if (gender) conditions.push(eq(students.gender, gender as (typeof genderEnum.enumValues)[number]));
    if (groupId) conditions.push(enrolledInGroup(students.id, tenantId, groupId));
    if (direction) conditions.push(enrolledInDirection(students.id, tenantId, direction));
    if (term) {
      const like = containsPattern(term);
      conditions.push(or(ilike(students.fullName, like), ilike(students.phone, like), ilike(students.parentPhone, like), enrolledInGroupNamed(students.id, tenantId, like))!);
    }

    const list = (limit?: number, offset?: number) => this.db.query.students.findMany({
      where: and(...conditions),
      with: {
        enrollments: { with: { group: true } },
        guardians: { with: { user: { columns: { id: true, fullName: true, email: true, phone: true } } } },
        branch: true,
      },
      orderBy: (st, { desc }) => [desc(st.createdAt), desc(st.id)],
      ...(limit ? { limit, offset } : {}),
    });
    if (!filters?.page) return list();
    const [{ total }] = await this.db.select({ total: count() }).from(students).where(and(...conditions));
    return { items: await list(pageSize, (page - 1) * pageSize), total: Number(total), page, pageSize };
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
        enrollments: { with: { group: { with: { teacher: { columns: { id: true, fullName: true } } } } } },
        guardians: { with: { user: { columns: { id: true, fullName: true, email: true, phone: true } } } },
        branch: true,
        payments: true,
      },
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    const customFields = await this.customFields.read(tenantId, 'STUDENT', id);
    // Payment history is finance data, not part of a teacher's view.
    if (scope) return { ...student, payments: [], customFields };
    return { ...student, customFields };
  }

  // Profile page: the student plus how they found the center, when they
  // came through admissions (lead source).
  async findProfile(tenantId: string, id: string, viewer?: { role?: string; userId?: string }) {
    const student = await this.findOne(tenantId, id, viewer);
    const [origin] = await this.db.select({ leadId: leads.id, source: leads.source, convertedAt: leads.convertedAt })
      .from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.convertedStudentId, id))).limit(1);
    return { ...student, origin: origin ?? null };
  }

  async create(tenantId: string, userId: string, dto: CreateStudentDto, rawKey?: string) {
    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    const groupIds = dto.groupIds && dto.groupIds.length > 0 ? dto.groupIds : dto.groupId ? [dto.groupId] : [];
    // Retry protection (see common/create-idempotency): the same key with
    // the same form returns the student made the first time, with nothing
    // done twice; the same key with a different form is a conflict.
    const key = idempotencyKey(rawKey);
    const { groupId: _single, groupIds: _many, customFields: customInput, ...fields } = dto;
    // The center's required fields must be answered; checked before anything is written.
    const customValues = await this.customFields.validate(tenantId, 'STUDENT', customInput, 'create');
    const hash = key ? requestHash('student.create', { ...fields, status: dto.status || 'ACTIVE', groupIds, ...(customInput ? { customFields: customInput } : {}) }) : null;
    const replay = async (db: Pick<Database, 'select'>) => {
      if (!key) return null;
      const [prior] = await db
        .select()
        .from(students)
        .where(and(eq(students.tenantId, tenantId), eq(students.idempotencyKey, key)));
      if (!prior) return null;
      if (prior.requestHash !== hash) throw new ConflictException("Bu Idempotency-Key boshqa ma'lumotli o'quvchi uchun ishlatilgan");
      return prior;
    };

    let result: { student: typeof students.$inferSelect; replayed: boolean };
    try {
      result = await this.db.transaction(async (tx) => {
        if (key) {
          await lockIdempotencyKey(tx, 'student.create', tenantId, key);
          const prior = await replay(tx);
          if (prior) return { student: prior, replayed: true };
        }
        const [student] = await tx
          .insert(students)
          .values({
            tenantId,
            branchId: dto.branchId || null,
            fullName: dto.fullName.trim(),
            gender: dto.gender as any,
            phone: blankToNull(dto.phone),
            parentPhone: blankToNull(dto.parentPhone),
            birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
            address: blankToNull(dto.address),
            telegramUsername: blankToNull(dto.telegramUsername),
            startDate: dto.startDate ? new Date(dto.startDate) : undefined,
            status: dto.status || 'ACTIVE',
            notes: dto.notes || null,
            avatarUrl: dto.avatarUrl || null,
            idempotencyKey: key,
            requestHash: hash,
          })
          .returning();

        await this.customFields.write(tx, tenantId, 'STUDENT', student.id, customValues, userId);

        if (groupIds.length > 0) {
          const validGroups = await tx.query.groups.findMany({
            where: and(eq(groups.tenantId, tenantId), inArray(groups.id, groupIds), isNull(groups.deletedAt)),
          });
          const validGroupIds = validGroups.map((g) => g.id);
          // A full group rolls back the whole create, student (and key) included.
          for (const groupId of validGroupIds) await this.lockGroupWithCapacity(tx, tenantId, groupId);
          await assertNoStudentTimeClash(tx, tenantId, null, validGroupIds);
          if (validGroupIds.length > 0) {
            const joined = await tx
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
              .onConflictDoNothing()
              .returning();
            // The stay in each group begins now (enrollments/membership.ts).
            if ((student.status ?? 'ACTIVE') === 'ACTIVE') {
              for (const e of joined) await openStay(tx, { tenantId, studentId: student.id, groupId: e.groupId, enrollmentId: e.id, at: e.joinedAt });
            }
          }
        }
        return { student, replayed: false };
      });
    } catch (err) {
      // Safety net behind the lock: the unique index refused a second row.
      if (key && isUniqueViolation(err, 'students_tenant_idem_uniq')) {
        const prior = await replay(this.db);
        if (prior) return publicRow(prior);
      }
      throw err;
    }
    // A retry gets the first student back; audit and webhook ran then.
    if (result.replayed) return publicRow(result.student);
    const student = publicRow(result.student);
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'student', entityId: student.id, meta: { fullName: student.fullName } });
    void this.webhooks.dispatch(tenantId, 'student.created', student);
    return student;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateStudentDto) {
    await this.findOne(tenantId, id);
    const { customFields: customInput, ...coreDto } = dto;
    const customValues = await this.customFields.validate(tenantId, 'STUDENT', customInput, 'update', id);

    if (dto.branchId) {
      const branch = await this.db.query.branches.findFirst({
        where: and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)),
      });
      if (!branch) throw new NotFoundException('Filial topilmadi');
    }

    const [student] = await this.db.transaction(async (tx) => {
      // The status is read again under the student's lock: two changes at
      // once must not each decide from the one the other is replacing, and
      // attendance is not checked against a stay that is about to end.
      await lockStudents(tx, tenantId, [id]);
      const [prev] = await tx.select({ status: students.status }).from(students)
        .where(and(eq(students.id, id), eq(students.tenantId, tenantId)));
      if (!prev) throw new NotFoundException("O'quvchi topilmadi");
      // Churn: remember when (and why) a student stops studying; coming back
      // clears it.
      const leaving = dto.status === 'LEFT' || dto.status === 'GRADUATED';
      const leftFields =
        dto.status !== undefined && dto.status !== prev.status
          ? leaving
            ? { leftAt: new Date(), leftReason: dto.status === 'LEFT' ? dto.leftReason ?? null : null }
            : { leftAt: null, leftReason: null }
          : dto.leftReason !== undefined && prev.status === 'LEFT'
            ? { leftReason: dto.leftReason }
            : {};
      // Months before a pause are still owed; the pause itself is not.
      const pauseFields =
        dto.status !== undefined && dto.status !== prev.status
          ? { pausedAt: dto.status === 'PAUSED' ? new Date() : null }
          : {};
      const rows = await tx
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
        ...leftFields,
        ...pauseFields,
        updatedAt: new Date(),
      })
      .where(and(eq(students.id, id), eq(students.tenantId, tenantId)))
      .returning();
      // Attending or not is part of the membership history: a pause, leaving
      // and graduating end the stays in every group; coming back begins new
      // ones (the enrollments themselves, and the seats, are untouched).
      if (dto.status !== undefined && dto.status !== prev.status) {
        if (dto.status === 'ACTIVE') await reopenStays(tx, { tenantId, studentId: id });
        else if (prev.status === 'ACTIVE') await closeStays(tx, { tenantId, studentId: id, reason: dto.status });
      }
      return rows;
    });
    await this.customFields.write(this.db, tenantId, 'STUDENT', id, customValues, userId);
    // Custom values are logged by field, not by content.
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'student', entityId: id, meta: { ...coreDto, ...(customInput ? { customFields: Object.keys(customValues) } : {}) } });
    return { ...student, customFields: await this.customFields.read(tenantId, 'STUDENT', id) };
  }

  async remove(tenantId: string, userId: string, id: string) {
    await this.findOne(tenantId, id);
    await this.db.transaction(async (tx) => {
      await lockStudents(tx, tenantId, [id]);
      const at = new Date();
      await tx
        .update(students)
        .set({ deletedAt: at })
        .where(and(eq(students.id, id), eq(students.tenantId, tenantId)));
      await closeStays(tx, { tenantId, studentId: id, reason: 'REMOVED', at });
    });
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'student', entityId: id });
    return { success: true };
  }

  async restore(tenantId: string, userId: string, id: string) {
    const student = await this.db.transaction(async (tx) => {
      await lockStudents(tx, tenantId, [id]);
      const [row] = await tx
        .update(students)
        .set({ deletedAt: null })
        .where(and(eq(students.id, id), eq(students.tenantId, tenantId)))
        .returning();
      // Back from the trash: attending again from now (the time in the trash is not a stay).
      if (row && row.status === 'ACTIVE') await reopenStays(tx, { tenantId, studentId: id });
      return row;
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");
    this.audit.log({ tenantId, userId, action: 'restore', entityType: 'student', entityId: id });
    return student;
  }

  // Portal PIN: a new 6-digit PIN is shown to staff once (to hand to the
  // student/parent); only its hash is kept. Issuing again replaces it.
  async portalPinStatus(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    const [row] = await this.db.select({ updatedAt: studentPortalPins.updatedAt }).from(studentPortalPins).where(eq(studentPortalPins.studentId, id));
    return { hasPin: Boolean(row), updatedAt: row?.updatedAt ?? null };
  }

  async issuePortalPin(tenantId: string, userId: string, id: string) {
    const student = await this.findOne(tenantId, id);
    const pin = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const pinHash = await bcrypt.hash(pin, 10);
    await this.db.insert(studentPortalPins).values({ studentId: id, pinHash, updatedAt: new Date() })
      .onConflictDoUpdate({ target: studentPortalPins.studentId, set: { pinHash, updatedAt: new Date() } });
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'student', entityId: id, meta: { portalPin: 'issued' } });
    return { pin, phone: student.phone ?? student.parentPhone ?? null };
  }

  async enroll(tenantId: string, studentId: string, groupId: string) {
    await this.findOne(tenantId, studentId);
    return this.db.transaction(async (tx) => {
      await lockStudents(tx, tenantId, [studentId]);
      // A paused student keeps a place in the group but is not attending: no stay begins until they are back.
      const [student] = await tx.select({ status: students.status }).from(students)
        .where(and(eq(students.id, studentId), eq(students.tenantId, tenantId)));
      const attending = student?.status === 'ACTIVE';
      const before = await tx.query.enrollments.findFirst({
        where: and(
          eq(enrollments.studentId, studentId),
          eq(enrollments.groupId, groupId),
        ),
      });

      if (before && before.status === 'ACTIVE') {
        // Checked before the capacity lock so a full group still reports
        // "already enrolled" for a student who is in it.
        await this.lockGroupWithCapacity(tx, tenantId, groupId, { skipCapacity: true });
        throw new BadRequestException("O'quvchi allaqachon ushbu guruhda faol ro'yxatdan o'tgan");
      }
      await this.lockGroupWithCapacity(tx, tenantId, groupId);
      // Under the group lock, look again: a second request for the same
      // student may have enrolled them while this one waited (it used to
      // run into the unique index and answer 500).
      const now = await tx.query.enrollments.findFirst({ where: and(eq(enrollments.studentId, studentId), eq(enrollments.groupId, groupId)) });
      if (now && now.status === 'ACTIVE') throw new BadRequestException("O'quvchi allaqachon ushbu guruhda faol ro'yxatdan o'tgan");
      const existing = now;
      await assertNoStudentTimeClash(tx, tenantId, studentId, [groupId]);

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
        // Back in the group: a NEW stay. The earlier one keeps its own start and end.
        if (attending) await openStay(tx, { tenantId, studentId, groupId, enrollmentId: reactivated.id, at: reactivated.joinedAt });
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
      if (attending) await openStay(tx, { tenantId, studentId, groupId, enrollmentId: created.id, at: created.joinedAt });

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

    const updated = await this.db.transaction(async (tx) => {
      await lockStudents(tx, tenantId, [studentId]);
      const left = new Date();
      const [row] = await tx
        .update(enrollments)
        .set({
          status: 'CANCELLED',
          leftAt: left,
        })
        .where(eq(enrollments.id, existing.id))
        .returning();
      await closeStays(tx, { tenantId, studentId, groupId, reason: 'LEFT_GROUP', at: left });
      return row;
    });

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

  /**
   * The student's stays in groups, newest first: when each began and ended,
   * why it ended, and whether it was written when it happened (RECORDED) or
   * taken over from the old single enrollment row (LEGACY: its start is the
   * last joining that row knew - earlier stays may have existed).
   */
  async memberships(tenantId: string, studentId: string, viewer?: { role?: string; userId?: string }) {
    await this.findOne(tenantId, studentId, viewer);
    const rows = await this.db.select({
      id: enrollmentPeriods.id, groupId: enrollmentPeriods.groupId, groupName: groups.name, startedAt: enrollmentPeriods.startedAt,
      endedAt: enrollmentPeriods.endedAt, endReason: enrollmentPeriods.endReason, source: enrollmentPeriods.source,
    }).from(enrollmentPeriods).innerJoin(groups, eq(groups.id, enrollmentPeriods.groupId))
      .where(and(eq(enrollmentPeriods.tenantId, tenantId), eq(enrollmentPeriods.studentId, studentId)));
    return rows.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async linkGuardian(tenantId: string, studentId: string, dto: LinkGuardianDto) {
    await this.findOne(tenantId, studentId);

    // Only a person who already belongs to this center can be linked (a
    // parent joins through a PARENT invitation first). Accounts of other
    // centers are never looked up, shown or given a membership here, and
    // "unknown" and "someone else's" get the same answer.
    const notHere = new NotFoundException(
      "Bu foydalanuvchi markazingizda topilmadi. Ota-onani avval taklifnoma (Ota-ona roli) orqali qo'shing.",
    );
    const cleanPhone = dto.phone?.trim();
    if (!dto.userId && !cleanPhone) {
      throw new BadRequestException("Ota-ona foydalanuvchi IDsi yoki telefon raqami ko'rsatilishi shart");
    }
    const [member] = await this.db
      .select({ userId: users.id, status: organizationMemberships.status })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(
        eq(organizationMemberships.tenantId, tenantId),
        dto.userId ? eq(users.id, dto.userId) : eq(users.phone, cleanPhone!),
      ))
      .limit(1);
    if (!member || member.status !== 'ACTIVE') throw notHere;
    const targetUserId = member.userId;

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

// The retry bookkeeping stays on the server.
function publicRow<T extends { idempotencyKey?: string | null; requestHash?: string | null }>(row: T) {
  const { idempotencyKey: _k, requestHash: _h, ...rest } = row;
  return rest;
}
