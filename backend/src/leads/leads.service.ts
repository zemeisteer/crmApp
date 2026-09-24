import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, or, sql, SQL } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  branches,
  courses,
  leadActivities,
  leads,
  leadTrials,
  organizationMemberships,
  subjects,
  tenants,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedDayBounds } from '../common/timezone';
import { AdmissionsEventsService } from './admissions-events.service';
import {
  allowedTransitions,
  canTransition,
  dedicatedFlowFor,
  FUNNEL_STAGES,
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  REOPEN_TARGET,
  type LeadStatus,
} from './lead-lifecycle';
import { maskPhone, normalizeEmail, normalizePhone } from './phone';
import {
  AssignLeadDto,
  CreateActivityDto,
  CreateLeadDto,
  FollowUpDto,
  FunnelQueryDto,
  LoseLeadDto,
  QueryLeadDto,
  UpdateLeadDto,
} from './dto/lead.dto';

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Tx;
export type LeadRow = typeof leads.$inferSelect;
type ActivityType = (typeof leadActivities.$inferInsert)['type'];

// Roles that may own a lead. Checked against the live membership, not the
// caller's token, so a revoked or cross-tenant user can never be assigned.
export const ASSIGNABLE_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'RECEPTIONIST'] as const;

// Statuses a lead can still be worked in; follow-up queues only show these.
export const OPEN_STATUSES: LeadStatus[] = ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'QUALIFIED'];

export interface Actor {
  userId: string | null;
  permissions: string[];
}

// Admissions rows always carry app-written timestamps instead of relying on
// the column's defaultNow(): with a non-UTC database session timezone, now()
// is stored as local wall-clock time while drizzle reads and compares these
// columns as UTC, which would shift cohort windows by the zone offset. See
// "Security/Integrity findings" in ADMISSIONS_SALES_CRM_REPORT.md.
export function appTimestamps() {
  const now = new Date();
  return { createdAt: now, updatedAt: now };
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function rate(numerator: number, denominator: number) {
  return {
    numerator,
    denominator,
    // null, not 0, when there is nothing to divide by: "no data" must not
    // read as "0% conversion".
    rate: denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
  };
}

@Injectable()
export class LeadsService {
  private readonly logger = new Logger('Admissions');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly events: AdmissionsEventsService,
  ) {}

  // ==================== READ ====================

  async findAll(tenantId: string, userId: string | null, query: QueryLeadDto = {}) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const tz = query.followUp ? await this.tenantTimezone(tenantId) : DEFAULT_TIMEZONE;
    const where = and(...this.buildFilters(tenantId, userId, query, tz));

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(leads)
      .where(where);

    const items = await this.db.query.leads.findMany({
      where,
      with: {
        desiredSubject: { columns: { id: true, name: true } },
        desiredCourse: { columns: { id: true, name: true } },
        preferredBranch: { columns: { id: true, name: true } },
        assignedManager: { columns: { id: true, fullName: true } },
      },
      orderBy: this.buildOrder(query.sort),
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return { items, total, page, pageSize };
  }

  private buildFilters(tenantId: string, userId: string | null, q: QueryLeadDto, tz: string): SQL[] {
    const c: SQL[] = [eq(leads.tenantId, tenantId)];
    if (q.includeArchived !== 'true') c.push(isNull(leads.archivedAt));
    if (q.status) c.push(inArray(leads.status, q.status.split(',') as LeadStatus[]));
    if (q.source) c.push(eq(leads.source, q.source));
    if (q.preferredBranchId) c.push(eq(leads.preferredBranchId, q.preferredBranchId));
    if (q.desiredSubjectId) c.push(eq(leads.desiredSubjectId, q.desiredSubjectId));
    if (q.desiredCourseId) c.push(eq(leads.desiredCourseId, q.desiredCourseId));
    if (q.lostReason) c.push(eq(leads.lostReason, q.lostReason));
    if (q.converted === 'true') c.push(isNotNull(leads.convertedStudentId));
    if (q.converted === 'false') c.push(isNull(leads.convertedStudentId));
    if (q.assignedManagerUserId === 'unassigned') c.push(isNull(leads.assignedManagerUserId));
    else if (q.assignedManagerUserId === 'me') c.push(eq(leads.assignedManagerUserId, userId ?? '__none__'));
    else if (q.assignedManagerUserId) c.push(eq(leads.assignedManagerUserId, q.assignedManagerUserId));
    if (q.createdFrom) c.push(gte(leads.createdAt, new Date(q.createdFrom)));
    if (q.createdTo) c.push(lt(leads.createdAt, new Date(q.createdTo)));
    if (q.followUpFrom) c.push(gte(leads.followUpAt, new Date(q.followUpFrom)));
    if (q.followUpTo) c.push(lt(leads.followUpAt, new Date(q.followUpTo)));
    if (q.followUp) c.push(...this.followUpBucket(q.followUp, new Date(), tz));

    const search = q.search?.trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      const parts: SQL[] = [ilike(leads.fullName, like), ilike(leads.phone, like), ilike(leads.emailNormalized, like)];
      const digits = search.replace(/\D/g, '');
      if (digits.length >= 4) parts.push(ilike(leads.phoneNormalized, `%${digits}%`));
      c.push(or(...parts)!);
    }
    return c;
  }

  // The center's own timezone (tenants.timezone), falling back to Tashkent
  // when unset or not a valid IANA zone name.
  async tenantTimezone(tenantId: string): Promise<string> {
    const [row] = await this.db.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return isValidTimeZone(row?.timezone) ? row.timezone : DEFAULT_TIMEZONE;
  }

  // Buckets are disjoint: overdue is before now, today is from now until
  // the end of the center's local day, upcoming is after that. Only open
  // leads count.
  private followUpBucket(bucket: 'overdue' | 'today' | 'upcoming' | 'none', now: Date, tz: string): SQL[] {
    if (bucket === 'none') return [isNull(leads.followUpAt), inArray(leads.status, OPEN_STATUSES)];
    const { endOfToday } = zonedDayBounds(now, tz);
    const open = inArray(leads.status, OPEN_STATUSES);
    if (bucket === 'overdue') return [open, lt(leads.followUpAt, now)];
    if (bucket === 'today') return [open, gte(leads.followUpAt, now), lt(leads.followUpAt, endOfToday)];
    return [open, gte(leads.followUpAt, endOfToday)];
  }

  private buildOrder(sort: QueryLeadDto['sort']): SQL[] {
    switch (sort) {
      case 'oldest':
        return [asc(leads.createdAt), asc(leads.id)];
      case 'next_follow_up':
        return [sql`${leads.followUpAt} asc nulls last`, desc(leads.createdAt)];
      case 'recently_updated':
        return [desc(leads.updatedAt), desc(leads.id)];
      default:
        return [desc(leads.createdAt), desc(leads.id)];
    }
  }

  async findOne(tenantId: string, id: string) {
    const lead = await this.db.query.leads.findFirst({
      where: and(eq(leads.id, id), eq(leads.tenantId, tenantId)),
      with: {
        desiredSubject: { columns: { id: true, name: true, status: true } },
        desiredCourse: { columns: { id: true, name: true, status: true, subjectId: true } },
        preferredBranch: { columns: { id: true, name: true } },
        assignedManager: { columns: { id: true, fullName: true } },
        convertedStudent: { columns: { id: true, fullName: true } },
        trials: {
          orderBy: desc(leadTrials.scheduledAt),
          with: {
            group: { columns: { id: true, name: true } },
            teacher: { columns: { id: true, fullName: true } },
            room: { columns: { id: true, name: true } },
          },
        },
      },
    });
    if (!lead) throw new NotFoundException('Lid topilmadi');

    // History stays readable after a manager leaves; the UI flags it so the
    // lead can be reassigned.
    let assignedManagerActive: boolean | null = null;
    if (lead.assignedManagerUserId) {
      const m = await this.activeAssignableMembership(this.db, tenantId, lead.assignedManagerUserId);
      assignedManagerActive = !!m;
    }
    return { ...lead, assignedManagerActive, allowedTransitions: allowedTransitions(lead.status) };
  }

  async timeline(tenantId: string, id: string) {
    await this.getLeadRow(this.db, tenantId, id);
    return this.db.query.leadActivities.findMany({
      where: and(eq(leadActivities.tenantId, tenantId), eq(leadActivities.leadId, id)),
      with: { actor: { columns: { id: true, fullName: true } } },
      orderBy: [desc(leadActivities.occurredAt), desc(leadActivities.createdAt)],
      limit: 500,
    });
  }

  async getLeadRow(exec: Executor, tenantId: string, id: string, opts: { lock?: boolean } = {}): Promise<LeadRow> {
    const where = and(eq(leads.id, id), eq(leads.tenantId, tenantId));
    const rows = opts.lock
      ? await exec.select().from(leads).where(where).for('update')
      : await exec.select().from(leads).where(where);
    if (!rows[0]) throw new NotFoundException('Lid topilmadi');
    return rows[0];
  }

  private assertMutable(lead: LeadRow) {
    if (lead.archivedAt) {
      throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan. Avval uni tiklang.' });
    }
  }

  // ==================== DUPLICATES ====================

  async findDuplicates(exec: Executor, tenantId: string, phoneNormalized: string | null, emailNormalized: string | null, excludeId?: string) {
    const match: SQL[] = [];
    if (phoneNormalized) match.push(eq(leads.phoneNormalized, phoneNormalized));
    if (emailNormalized) match.push(eq(leads.emailNormalized, emailNormalized));
    if (match.length === 0) return [];
    const conditions: SQL[] = [
      eq(leads.tenantId, tenantId),
      isNull(leads.archivedAt),
      isNull(leads.duplicateOfLeadId),
      or(...match)!,
    ];
    if (excludeId) conditions.push(ne(leads.id, excludeId));
    const rows = await exec
      .select({
        id: leads.id,
        fullName: leads.fullName,
        status: leads.status,
        phoneNormalized: leads.phoneNormalized,
        emailNormalized: leads.emailNormalized,
      })
      .from(leads)
      .where(and(...conditions))
      .limit(5);
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      status: r.status,
      matchedOn: phoneNormalized && r.phoneNormalized === phoneNormalized ? 'phone' : 'email',
    }));
  }

  async checkDuplicates(tenantId: string, phone?: string, email?: string) {
    return {
      duplicates: await this.findDuplicates(this.db, tenantId, normalizePhone(phone), normalizeEmail(email)),
    };
  }

  private duplicateConflict(duplicates: Awaited<ReturnType<LeadsService['findDuplicates']>>) {
    return new ConflictException({
      code: 'DUPLICATE_LEAD',
      message: "Bu telefon yoki email bilan faol lid allaqachon mavjud",
      duplicates,
    });
  }

  private requirePhone(raw: string) {
    const normalized = normalizePhone(raw);
    if (!normalized) throw new BadRequestException("Telefon raqami noto'g'ri formatda");
    return normalized;
  }

  // ==================== REFERENCE VALIDATION ====================

  // New assignments must point at live, same-tenant records; archived
  // subjects/courses stay readable on old leads but cannot be chosen again.
  private async validateRefs(
    exec: Executor,
    tenantId: string,
    refs: { desiredSubjectId?: string | null; desiredCourseId?: string | null; preferredBranchId?: string | null },
    current?: Pick<LeadRow, 'desiredSubjectId' | 'desiredCourseId'>,
  ) {
    if (refs.preferredBranchId) {
      const [b] = await exec.select({ id: branches.id }).from(branches)
        .where(and(eq(branches.id, refs.preferredBranchId), eq(branches.tenantId, tenantId)));
      if (!b) throw new BadRequestException('Filial topilmadi');
    }
    if (refs.desiredSubjectId) {
      const [s] = await exec.select({ id: subjects.id, status: subjects.status }).from(subjects)
        .where(and(eq(subjects.id, refs.desiredSubjectId), eq(subjects.tenantId, tenantId)));
      if (!s) throw new BadRequestException('Fan topilmadi');
      if (s.status === 'ARCHIVED') throw new BadRequestException('Arxivlangan fanni tanlab bo\'lmaydi');
    }
    if (refs.desiredCourseId) {
      const [c] = await exec.select({ id: courses.id, status: courses.status, subjectId: courses.subjectId }).from(courses)
        .where(and(eq(courses.id, refs.desiredCourseId), eq(courses.tenantId, tenantId)));
      if (!c) throw new BadRequestException('Kurs topilmadi');
      if (c.status === 'ARCHIVED') throw new BadRequestException('Arxivlangan kursni tanlab bo\'lmaydi');
      const subjectId = refs.desiredSubjectId !== undefined ? refs.desiredSubjectId : current?.desiredSubjectId;
      if (subjectId && c.subjectId && c.subjectId !== subjectId) {
        throw new BadRequestException('Kurs tanlangan fanga tegishli emas');
      }
    }
  }

  async activeAssignableMembership(exec: Executor, tenantId: string, userId: string) {
    const [m] = await exec
      .select({ id: organizationMemberships.id, role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.tenantId, tenantId),
          eq(organizationMemberships.userId, userId),
          eq(organizationMemberships.status, 'ACTIVE'),
          inArray(organizationMemberships.role, [...ASSIGNABLE_ROLES]),
        ),
      );
    return m ?? null;
  }

  async listAssignableManagers(tenantId: string) {
    return this.db
      .select({ userId: users.id, fullName: users.fullName, role: organizationMemberships.role })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.tenantId, tenantId),
          eq(organizationMemberships.status, 'ACTIVE'),
          inArray(organizationMemberships.role, [...ASSIGNABLE_ROLES]),
        ),
      )
      .orderBy(asc(users.fullName));
  }

  private async requireAssignableManager(exec: Executor, tenantId: string, userId: string) {
    const m = await this.activeAssignableMembership(exec, tenantId, userId);
    // Same message whether the user is foreign, inactive or the wrong role,
    // so the response never confirms that a user exists in another tenant.
    if (!m) throw new BadRequestException("Tanlangan xodim bu markazda lidlarni boshqara olmaydi");
  }

  // ==================== ACTIVITIES ====================

  async recordActivity(
    exec: Executor,
    a: {
      tenantId: string;
      leadId: string;
      actorUserId: string | null;
      type: ActivityType;
      body?: string | null;
      fromStatus?: LeadStatus | null;
      toStatus?: LeadStatus | null;
      metadata?: Record<string, unknown>;
      occurredAt?: Date;
    },
  ) {
    const [row] = await exec
      .insert(leadActivities)
      .values({
        tenantId: a.tenantId,
        leadId: a.leadId,
        actorUserId: a.actorUserId,
        type: a.type,
        body: a.body ?? null,
        fromStatus: a.fromStatus ?? null,
        toStatus: a.toStatus ?? null,
        metadata: a.metadata ?? null,
        occurredAt: a.occurredAt ?? new Date(),
        createdAt: new Date(),
      })
      .returning();
    return row;
  }

  async addActivity(tenantId: string, actor: Actor, id: string, dto: CreateActivityDto) {
    const lead = await this.getLeadRow(this.db, tenantId, id);
    this.assertMutable(lead);
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      throw new BadRequestException("Faoliyat vaqti kelajakda bo'lishi mumkin emas");
    }
    const activity = await this.db.transaction(async (tx) => {
      const row = await this.recordActivity(tx, {
        tenantId, leadId: id, actorUserId: actor.userId, type: dto.type, body: dto.body.trim(), occurredAt,
      });
      await tx.update(leads).set({ updatedAt: new Date() }).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)));
      return row;
    });
    return activity;
  }

  // ==================== CREATE / UPDATE ====================

  async create(tenantId: string, actor: Actor, dto: CreateLeadDto) {
    const phoneNormalized = this.requirePhone(dto.phone);
    const emailNormalized = normalizeEmail(dto.email);

    if (dto.assignedManagerUserId && !actor.permissions.includes('admissions.assign')) {
      throw new ForbiddenException("Lidni xodimga biriktirish uchun ruxsat yo'q");
    }
    if (dto.allowDuplicate && !actor.permissions.includes('admissions.manage')) {
      throw new ForbiddenException("Dublikat lid yaratish uchun ruxsat yo'q");
    }

    await this.validateRefs(this.db, tenantId, dto);
    if (dto.assignedManagerUserId) await this.requireAssignableManager(this.db, tenantId, dto.assignedManagerUserId);

    const duplicates = await this.findDuplicates(this.db, tenantId, phoneNormalized, emailNormalized);
    if (duplicates.length > 0 && !dto.allowDuplicate) throw this.duplicateConflict(duplicates);
    const duplicateOfLeadId = duplicates.length > 0 ? duplicates[0].id : null;

    let lead: LeadRow;
    try {
      lead = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(leads)
          .values({
            tenantId,
            fullName: dto.fullName.trim(),
            phone: dto.phone.trim(),
            phoneNormalized,
            secondaryPhone: dto.secondaryPhone?.trim() || null,
            email: dto.email?.trim() || null,
            emailNormalized,
            source: dto.source ?? 'OTHER',
            desiredSubjectId: dto.desiredSubjectId || null,
            desiredCourseId: dto.desiredCourseId || null,
            preferredBranchId: dto.preferredBranchId || null,
            assignedManagerUserId: dto.assignedManagerUserId || null,
            followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null,
            notes: dto.notes?.trim() || null,
            duplicateOfLeadId,
            createdByUserId: actor.userId,
            ...appTimestamps(),
          })
          .returning();
        await this.recordActivity(tx, {
          tenantId, leadId: row.id, actorUserId: actor.userId, type: 'STATUS_CHANGE', toStatus: 'NEW',
          metadata: { kind: 'CREATED', source: row.source },
        });
        if (row.followUpAt) {
          await this.recordActivity(tx, {
            tenantId, leadId: row.id, actorUserId: actor.userId, type: 'FOLLOW_UP_SCHEDULED',
            metadata: { followUpAt: row.followUpAt.toISOString() },
          });
        }
        return row;
      });
    } catch (err) {
      // Lost the race against a concurrent insert of the same contact.
      if (isUniqueViolation(err)) {
        throw this.duplicateConflict(await this.findDuplicates(this.db, tenantId, phoneNormalized, emailNormalized));
      }
      throw err;
    }

    if (duplicateOfLeadId) {
      this.audit.log({
        tenantId, userId: actor.userId, action: 'duplicate_override', entityType: 'lead', entityId: lead.id,
        meta: { duplicateOfLeadId, reason: dto.duplicateReason },
      });
    }
    this.logger.log(JSON.stringify({ op: 'lead.create', tenantId, leadId: lead.id, actorUserId: actor.userId, phone: maskPhone(phoneNormalized) }));
    this.events.emit('LeadCreated', { tenantId, leadId: lead.id, actorUserId: actor.userId, data: { source: lead.source } });
    if (lead.assignedManagerUserId) {
      this.events.emit('LeadAssigned', { tenantId, leadId: lead.id, actorUserId: actor.userId, data: { managerUserId: lead.assignedManagerUserId } });
    }
    return lead;
  }

  // Entry point for the tenant's public website form. Never fails on a
  // duplicate: a repeat application is appended to the existing lead's
  // timeline instead, and the response does not reveal which case happened.
  async createFromPublicForm(
    tenantId: string,
    dto: { fullName: string; phone: string; secondaryPhone?: string; subjectText?: string; branchId?: string; notes?: string },
  ) {
    const phoneNormalized = this.requirePhone(dto.phone);
    const [existing] = await this.findDuplicates(this.db, tenantId, phoneNormalized, null);
    const noteText = dto.notes?.trim()
      ? `Saytdan onlayn ariza: ${dto.notes.trim()}`
      : 'Markaz veb-saytidan onlayn ariza topshirildi';

    if (existing) {
      await this.recordActivity(this.db, {
        tenantId, leadId: existing.id, actorUserId: null, type: 'NOTE',
        body: `Takroriy onlayn ariza. ${noteText}`, metadata: { kind: 'PUBLIC_REAPPLY' },
      });
      return { id: existing.id };
    }

    let branchId: string | null = null;
    if (dto.branchId) {
      const [b] = await this.db.select({ id: branches.id }).from(branches)
        .where(and(eq(branches.id, dto.branchId), eq(branches.tenantId, tenantId)));
      branchId = b?.id ?? null;
    }
    // Link the free-text interest to a real subject when it matches one.
    let desiredSubjectId: string | null = null;
    const subjectText = dto.subjectText?.trim() || null;
    if (subjectText) {
      const matches = await this.db.select({ id: subjects.id }).from(subjects).where(
        and(eq(subjects.tenantId, tenantId), eq(subjects.status, 'ACTIVE'), sql`lower(trim(${subjects.name})) = lower(${subjectText})`),
      );
      if (matches.length === 1) desiredSubjectId = matches[0].id;
    }

    try {
      const lead = await this.db.transaction(async (tx) => {
        const [row] = await tx.insert(leads).values({
          tenantId,
          fullName: dto.fullName.trim(),
          phone: dto.phone.trim(),
          phoneNormalized,
          secondaryPhone: dto.secondaryPhone?.trim() || null,
          source: 'WEBSITE',
          desiredSubjectId,
          legacySubject: desiredSubjectId ? null : subjectText,
          preferredBranchId: branchId,
          notes: noteText,
          ...appTimestamps(),
        }).returning();
        await this.recordActivity(tx, {
          tenantId, leadId: row.id, actorUserId: null, type: 'STATUS_CHANGE', toStatus: 'NEW',
          metadata: { kind: 'CREATED', source: 'WEBSITE' },
        });
        return row;
      });
      this.events.emit('LeadCreated', { tenantId, leadId: lead.id, actorUserId: null, data: { source: 'WEBSITE' } });
      return { id: lead.id };
    } catch (err) {
      if (isUniqueViolation(err)) {
        const [dup] = await this.findDuplicates(this.db, tenantId, phoneNormalized, null);
        if (dup) return { id: dup.id };
      }
      throw err;
    }
  }

  async update(tenantId: string, actor: Actor, id: string, dto: UpdateLeadDto) {
    if (dto.status !== undefined) {
      throw new BadRequestException({
        code: 'STATUS_NOT_EDITABLE',
        message: "Status bu yerda o'zgartirilmaydi. POST /leads/:id/transition dan foydalaning.",
      });
    }
    const lead = await this.getLeadRow(this.db, tenantId, id);
    this.assertMutable(lead);
    await this.validateRefs(this.db, tenantId, dto, lead);

    const set: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
    if (dto.fullName !== undefined) set.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      set.phone = dto.phone.trim();
      set.phoneNormalized = this.requirePhone(dto.phone);
    }
    if (dto.secondaryPhone !== undefined) set.secondaryPhone = dto.secondaryPhone?.trim() || null;
    if (dto.email !== undefined) {
      set.email = dto.email?.trim() || null;
      set.emailNormalized = normalizeEmail(dto.email);
    }
    if (dto.source !== undefined) set.source = dto.source;
    if (dto.desiredSubjectId !== undefined) set.desiredSubjectId = dto.desiredSubjectId || null;
    if (dto.desiredCourseId !== undefined) set.desiredCourseId = dto.desiredCourseId || null;
    if (dto.preferredBranchId !== undefined) set.preferredBranchId = dto.preferredBranchId || null;
    if (dto.notes !== undefined) set.notes = dto.notes?.trim() || null;

    const contactChanged =
      (set.phoneNormalized !== undefined && set.phoneNormalized !== lead.phoneNormalized) ||
      (set.emailNormalized !== undefined && set.emailNormalized !== lead.emailNormalized);
    if (contactChanged && !lead.duplicateOfLeadId) {
      const duplicates = await this.findDuplicates(
        this.db, tenantId,
        set.phoneNormalized !== undefined ? set.phoneNormalized : null,
        set.emailNormalized !== undefined ? set.emailNormalized : null,
        id,
      );
      if (duplicates.length > 0) throw this.duplicateConflict(duplicates);
    }

    try {
      const [updated] = await this.db.update(leads).set(set)
        .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId), isNull(leads.archivedAt)))
        .returning();
      if (!updated) throw new ConflictException({ code: 'LEAD_ARCHIVED', message: 'Lid arxivlangan' });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw this.duplicateConflict(await this.findDuplicates(this.db, tenantId, set.phoneNormalized ?? null, set.emailNormalized ?? null, id));
      }
      throw err;
    }
  }

  // ==================== LIFECYCLE ====================

  // Atomically moves `lead` from its current status to `to`. The UPDATE is
  // conditional on the status we validated, so two concurrent moves cannot
  // both succeed; the loser gets 409. Must run inside a transaction together
  // with any side effects of the move.
  async applyTransition(
    tx: Tx,
    tenantId: string,
    lead: LeadRow,
    to: LeadStatus,
    actorUserId: string | null,
    activity: { type: ActivityType; body?: string | null; metadata?: Record<string, unknown> },
    extraSet: Partial<typeof leads.$inferInsert> = {},
  ) {
    const [updated] = await tx
      .update(leads)
      .set({ ...extraSet, status: to, updatedAt: new Date() })
      .where(and(eq(leads.id, lead.id), eq(leads.tenantId, tenantId), eq(leads.status, lead.status), isNull(leads.archivedAt)))
      .returning();
    if (!updated) {
      throw new ConflictException({ code: 'CONCURRENT_UPDATE', message: "Lid holati boshqa foydalanuvchi tomonidan o'zgartirildi. Sahifani yangilang." });
    }
    await this.recordActivity(tx, {
      tenantId, leadId: lead.id, actorUserId, type: activity.type, body: activity.body ?? null,
      fromStatus: lead.status, toStatus: to, metadata: activity.metadata,
    });
    return updated;
  }

  assertTransition(from: LeadStatus, to: LeadStatus) {
    if (!canTransition(from, to)) {
      throw new ConflictException({
        code: 'INVALID_TRANSITION',
        message: `"${from}" holatidan "${to}" holatiga o'tib bo'lmaydi`,
        from, to, allowed: allowedTransitions(from),
      });
    }
  }

  async transition(tenantId: string, actor: Actor, id: string, to: LeadStatus, note?: string) {
    const flow = dedicatedFlowFor(to);
    if (flow) {
      throw new BadRequestException({ code: 'DEDICATED_FLOW', message: `Bu holat uchun alohida amal ishlatiladi: ${flow}` });
    }
    const updated = await this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      this.assertMutable(lead);
      this.assertTransition(lead.status, to);
      return this.applyTransition(tx, tenantId, lead, to, actor.userId, { type: 'STATUS_CHANGE', body: note?.trim() || null });
    });
    if (to === 'QUALIFIED') this.events.emit('LeadQualified', { tenantId, leadId: id, actorUserId: actor.userId });
    return updated;
  }

  async lose(tenantId: string, actor: Actor, id: string, dto: LoseLeadDto) {
    const updated = await this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      this.assertMutable(lead);
      this.assertTransition(lead.status, 'LOST');
      // A lost lead keeps no live trial booking.
      const cancelled = await tx.update(leadTrials)
        .set({ status: 'CANCELLED', outcomeNote: 'Lid yo\'qotildi', updatedAt: new Date() })
        .where(and(eq(leadTrials.tenantId, tenantId), eq(leadTrials.leadId, id), eq(leadTrials.status, 'BOOKED')))
        .returning({ id: leadTrials.id });
      return this.applyTransition(
        tx, tenantId, lead, 'LOST', actor.userId,
        { type: 'LOST', body: dto.note?.trim() || null, metadata: { reason: dto.reason, cancelledTrialIds: cancelled.map((c) => c.id) } },
        { lostReason: dto.reason, lostNote: dto.note?.trim() || null, lostAt: new Date(), followUpAt: null, followUpNotifiedAt: null },
      );
    });
    this.events.emit('LeadLost', { tenantId, leadId: id, actorUserId: actor.userId, data: { reason: dto.reason } });
    return updated;
  }

  async reopen(tenantId: string, actor: Actor, id: string, note: string) {
    const updated = await this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      this.assertMutable(lead);
      if (lead.status !== 'LOST') {
        throw new ConflictException({ code: 'INVALID_TRANSITION', message: "Faqat yo'qotilgan lidni qayta ochish mumkin", from: lead.status, to: REOPEN_TARGET });
      }
      // The previous reason stays in the LOST activity and in this one; the
      // live columns are cleared so the lead's current state is consistent.
      return this.applyTransition(
        tx, tenantId, lead, REOPEN_TARGET, actor.userId,
        { type: 'REOPENED', body: note.trim(), metadata: { previousLostReason: lead.lostReason, previousLostNote: lead.lostNote, previousLostAt: lead.lostAt?.toISOString() ?? null } },
        { lostReason: null, lostNote: null, lostAt: null },
      );
    });
    this.audit.log({ tenantId, userId: actor.userId, action: 'reopen', entityType: 'lead', entityId: id, meta: { to: REOPEN_TARGET } });
    return updated;
  }

  // ==================== ASSIGNMENT / FOLLOW-UP ====================

  async assign(tenantId: string, actor: Actor, id: string, dto: AssignLeadDto) {
    const managerUserId = dto.managerUserId ?? null;
    const result = await this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      this.assertMutable(lead);
      if (managerUserId) await this.requireAssignableManager(tx, tenantId, managerUserId);
      if (lead.assignedManagerUserId === managerUserId) return { lead, changed: false, previous: lead.assignedManagerUserId };
      const [updated] = await tx.update(leads)
        .set({ assignedManagerUserId: managerUserId, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
        .returning();
      await this.recordActivity(tx, {
        tenantId, leadId: id, actorUserId: actor.userId, type: 'NOTE',
        metadata: { kind: 'ASSIGNED', fromUserId: lead.assignedManagerUserId, toUserId: managerUserId },
      });
      return { lead: updated, changed: true, previous: lead.assignedManagerUserId };
    });
    if (result.changed) {
      this.audit.log({
        tenantId, userId: actor.userId, action: result.previous ? 'reassign' : 'assign', entityType: 'lead', entityId: id,
        meta: { fromUserId: result.previous, toUserId: managerUserId },
      });
      if (managerUserId) {
        this.events.emit('LeadAssigned', { tenantId, leadId: id, actorUserId: actor.userId, data: { managerUserId } });
      }
    }
    return result.lead;
  }

  async setFollowUp(tenantId: string, actor: Actor, id: string, dto: FollowUpDto) {
    const followUpAt = dto.followUpAt ? new Date(dto.followUpAt) : null;
    return this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      this.assertMutable(lead);
      if (followUpAt && !OPEN_STATUSES.includes(lead.status)) {
        throw new ConflictException({ code: 'LEAD_CLOSED', message: "Yopilgan lid uchun qayta aloqa belgilab bo'lmaydi" });
      }
      const [updated] = await tx.update(leads)
        .set({ followUpAt, followUpNotifiedAt: null, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
        .returning();
      await this.recordActivity(tx, {
        tenantId, leadId: id, actorUserId: actor.userId, type: 'FOLLOW_UP_SCHEDULED', body: dto.note?.trim() || null,
        metadata: { followUpAt: followUpAt?.toISOString() ?? null, previous: lead.followUpAt?.toISOString() ?? null },
      });
      return updated;
    });
  }

  async followUpSummary(tenantId: string, userId: string | null, mine: boolean) {
    const now = new Date();
    const tz = await this.tenantTimezone(tenantId);
    const base: SQL[] = [eq(leads.tenantId, tenantId), isNull(leads.archivedAt)];
    if (mine) base.push(eq(leads.assignedManagerUserId, userId ?? '__none__'));
    const count = async (bucket: 'overdue' | 'today' | 'upcoming') => {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(leads)
        .where(and(...base, ...this.followUpBucket(bucket, now, tz)));
      return n;
    };
    const [overdue, today, upcoming] = await Promise.all([count('overdue'), count('today'), count('upcoming')]);
    return { overdue, today, upcoming, asOf: now.toISOString(), timezone: tz };
  }

  // Emits LeadFollowUpDue once per scheduled follow-up. The claim is a single
  // conditional UPDATE, so concurrent scanners (multiple instances) never
  // emit the same follow-up twice.
  async scanDueFollowUps(now = new Date(), tenantId?: string) {
    const conditions: SQL[] = [
      isNull(leads.archivedAt),
      isNull(leads.followUpNotifiedAt),
      isNotNull(leads.followUpAt),
      lt(leads.followUpAt, now),
      inArray(leads.status, OPEN_STATUSES),
    ];
    if (tenantId) conditions.push(eq(leads.tenantId, tenantId));
    const claimed = await this.db.update(leads)
      .set({ followUpNotifiedAt: now })
      .where(and(...conditions))
      .returning({ id: leads.id, tenantId: leads.tenantId, managerUserId: leads.assignedManagerUserId, followUpAt: leads.followUpAt });
    for (const c of claimed) {
      this.events.emit('LeadFollowUpDue', {
        tenantId: c.tenantId, leadId: c.id, actorUserId: null,
        data: { managerUserId: c.managerUserId, followUpAt: c.followUpAt?.toISOString() ?? null },
      });
    }
    return claimed.length;
  }

  // ==================== ARCHIVE ====================

  async archive(tenantId: string, actor: Actor, id: string, reason?: string) {
    const updated = await this.db.transaction(async (tx) => {
      const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
      if (lead.archivedAt) return lead;
      await tx.update(leadTrials)
        .set({ status: 'CANCELLED', outcomeNote: 'Lid arxivlandi', updatedAt: new Date() })
        .where(and(eq(leadTrials.tenantId, tenantId), eq(leadTrials.leadId, id), eq(leadTrials.status, 'BOOKED')));
      const [row] = await tx.update(leads)
        .set({ archivedAt: new Date(), followUpAt: null, updatedAt: new Date() })
        .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
        .returning();
      await this.recordActivity(tx, {
        tenantId, leadId: id, actorUserId: actor.userId, type: 'NOTE', body: reason?.trim() || null, metadata: { kind: 'ARCHIVED' },
      });
      return row;
    });
    this.audit.log({ tenantId, userId: actor.userId, action: 'archive', entityType: 'lead', entityId: id, meta: { reason: reason ?? null } });
    return updated;
  }

  async restore(tenantId: string, actor: Actor, id: string) {
    try {
      const updated = await this.db.transaction(async (tx) => {
        const lead = await this.getLeadRow(tx, tenantId, id, { lock: true });
        if (!lead.archivedAt) return lead;
        const [row] = await tx.update(leads)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(and(eq(leads.id, id), eq(leads.tenantId, tenantId)))
          .returning();
        await this.recordActivity(tx, { tenantId, leadId: id, actorUserId: actor.userId, type: 'NOTE', metadata: { kind: 'RESTORED' } });
        return row;
      });
      this.audit.log({ tenantId, userId: actor.userId, action: 'restore', entityType: 'lead', entityId: id });
      return updated;
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException({ code: 'DUPLICATE_LEAD', message: "Bu kontakt bilan boshqa faol lid bor, tiklab bo'lmaydi" });
      }
      throw err;
    }
  }

  // ==================== ANALYTICS ====================

  // Legacy snapshot shape kept for existing consumers: counts by *current*
  // status of non-archived leads.
  async getFunnelStats(tenantId: string) {
    const all = await this.db.query.leads.findMany({
      where: and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt)),
      columns: { id: true, status: true, source: true },
    });
    const counts = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    const bySource: Record<string, { total: number; enrolled: number; conversionRate: number }> = {};
    for (const l of all) {
      counts[l.status] = (counts[l.status] || 0) + 1;
      const s = (bySource[l.source] ??= { total: 0, enrolled: 0, conversionRate: 0 });
      s.total++;
      if (l.status === 'ENROLLED') s.enrolled++;
    }
    for (const s of Object.values(bySource)) s.conversionRate = s.total > 0 ? Math.round((s.enrolled / s.total) * 100) : 0;
    const total = all.length;
    return { total, counts, conversionRate: total > 0 ? Math.round((counts.ENROLLED / total) * 100) : 0, bySource };
  }

  // Two deliberately separate views (see ADMISSIONS_SALES_CRM_REPORT.md):
  //  - snapshot: where non-archived leads are *now*, regardless of age;
  //  - cohort: leads *created* in [from, to), and which stages each of them
  //    has *ever* reached (from the activity history), so rates for one
  //    cohort never mix with leads from other periods.
  async getAnalytics(tenantId: string, q: FunnelQueryDto) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 60 * 60_000);
    if (from >= to) throw new BadRequestException("'from' sanasi 'to' dan oldin bo'lishi kerak");

    const scope: SQL[] = [eq(leads.tenantId, tenantId), isNull(leads.archivedAt)];
    if (q.preferredBranchId) scope.push(eq(leads.preferredBranchId, q.preferredBranchId));
    if (q.assignedManagerUserId) scope.push(eq(leads.assignedManagerUserId, q.assignedManagerUserId));

    const snapshotRows = await this.db
      .select({ status: leads.status, n: sql<number>`count(*)::int` })
      .from(leads).where(and(...scope)).groupBy(leads.status);
    const snapshot = Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as Record<LeadStatus, number>;
    for (const r of snapshotRows) snapshot[r.status] = r.n;

    const cohort = await this.db
      .select({
        id: leads.id, status: leads.status, source: leads.source, lostReason: leads.lostReason,
        managerUserId: leads.assignedManagerUserId,
      })
      .from(leads)
      .where(and(...scope, gte(leads.createdAt, from), lt(leads.createdAt, to)));

    const reached = new Map<string, Set<LeadStatus>>();
    for (const l of cohort) reached.set(l.id, new Set<LeadStatus>(['NEW', l.status]));
    if (cohort.length > 0) {
      const history = await this.db
        .selectDistinct({ leadId: leadActivities.leadId, toStatus: leadActivities.toStatus })
        .from(leadActivities)
        .where(and(
          eq(leadActivities.tenantId, tenantId),
          inArray(leadActivities.leadId, cohort.map((l) => l.id)),
          isNotNull(leadActivities.toStatus),
        ));
      for (const h of history) if (h.toStatus) reached.get(h.leadId)?.add(h.toStatus);
    }

    const reachedCount = (s: LeadStatus) => cohort.filter((l) => reached.get(l.id)!.has(s)).length;
    const stages = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, reachedCount(s)])) as Record<LeadStatus, number>;
    const total = cohort.length;
    const lost = cohort.filter((l) => l.status === 'LOST').length;

    const bySource = LEAD_SOURCES.map((source) => {
      const rows = cohort.filter((l) => l.source === source);
      return { source, ...rate(rows.filter((l) => l.status === 'ENROLLED').length, rows.length) };
    }).filter((r) => r.denominator > 0);

    const lostReasons = LEAD_LOST_REASONS.map((reason) => ({
      reason, count: cohort.filter((l) => l.status === 'LOST' && l.lostReason === reason).length,
    })).filter((r) => r.count > 0);

    const managerIds = [...new Set(cohort.map((l) => l.managerUserId).filter((x): x is string => !!x))];
    const managerNames = managerIds.length
      ? await this.db.query.users.findMany({ where: (u, { inArray: inA }) => inA(u.id, managerIds), columns: { id: true, fullName: true } })
      : [];
    const managers = [null, ...managerIds].map((mid) => {
      const rows = cohort.filter((l) => (l.managerUserId ?? null) === mid);
      return {
        managerUserId: mid,
        fullName: mid ? managerNames.find((u) => u.id === mid)?.fullName ?? null : null,
        assigned: rows.length,
        enrolled: rows.filter((l) => l.status === 'ENROLLED').length,
        lost: rows.filter((l) => l.status === 'LOST').length,
        open: rows.filter((l) => OPEN_STATUSES.includes(l.status)).length,
      };
    }).filter((m) => m.assigned > 0);

    return {
      definitions: {
        snapshot: 'Current status of all non-archived leads (any creation date).',
        cohort: 'Leads created in [from, to); a stage counts if the lead ever reached it.',
        conversion: 'cohort leads now ENROLLED / cohort leads',
        rateIsNullWhenDenominatorIsZero: true,
      },
      window: { from: from.toISOString(), to: to.toISOString() },
      snapshot: { total: Object.values(snapshot).reduce((a, b) => a + b, 0), byStatus: snapshot },
      cohort: {
        total,
        reached: stages,
        lost,
        rates: {
          contacted: rate(stages.CONTACTED, total),
          trialBooked: rate(stages.TRIAL_BOOKED, stages.CONTACTED),
          trialAttended: rate(stages.TRIAL_ATTENDED, stages.TRIAL_BOOKED),
          qualified: rate(stages.QUALIFIED, total),
          conversion: rate(stages.ENROLLED, total),
          lost: rate(lost, total),
        },
        bySource,
        lostReasons,
        managers,
      },
      followUps: await this.followUpSummary(tenantId, null, false),
    };
  }

  // ==================== EXPORT ====================

  async exportCsv(tenantId: string, actor: Actor, query: QueryLeadDto) {
    const tz = query.followUp ? await this.tenantTimezone(tenantId) : DEFAULT_TIMEZONE;
    const rows = await this.db.query.leads.findMany({
      where: and(...this.buildFilters(tenantId, actor.userId, query, tz)),
      with: {
        desiredSubject: { columns: { name: true } },
        desiredCourse: { columns: { name: true } },
        preferredBranch: { columns: { name: true } },
        assignedManager: { columns: { fullName: true } },
      },
      orderBy: this.buildOrder(query.sort),
      limit: 5000,
    });
    // Leading =,+,-,@ would be evaluated as formulas by spreadsheet apps.
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['fullName', 'phone', 'email', 'status', 'source', 'subject', 'course', 'branch', 'manager', 'followUpAt', 'lostReason', 'converted', 'createdAt'];
    const lines = rows.map((l) => [
      l.fullName, l.phone, l.email, l.status, l.source, l.desiredSubject?.name ?? l.legacySubject, l.desiredCourse?.name,
      l.preferredBranch?.name, l.assignedManager?.fullName, l.followUpAt, l.lostReason, l.convertedStudentId ? 'yes' : 'no', l.createdAt,
    ].map(cell).join(','));
    this.audit.log({ tenantId, userId: actor.userId, action: 'export', entityType: 'lead', entityId: 'csv', meta: { rows: rows.length } });
    return '﻿' + [header.join(','), ...lines].join('\r\n');
  }
}
