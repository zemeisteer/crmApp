import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { jobCandidates, placementAttempts, placementTests } from '../db/schema';
import { normalizePhone } from '../leads/phone';
import { TeachersService } from '../teachers/teachers.service';
import { CANDIDATE_STAGES, type CandidateStage, CreateCandidateDto, QueryCandidatesDto, UpdateCandidateDto } from './hiring.dto';

type Candidate = typeof jobCandidates.$inferSelect;
type HistoryEntry = { stage: CandidateStage; at: string; by: string | null };

/**
 * Teacher hiring: candidates, their test, interview, demo lesson and the
 * decision; a hired candidate becomes a teacher through the teachers'
 * own create (so the plan's teacher limit and the audit apply).
 */
@Injectable()
export class HiringService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly teachers: TeachersService,
    private readonly audit: AuditService,
  ) {}

  private history(c: Pick<Candidate, 'history'>): HistoryEntry[] {
    try {
      const v = JSON.parse(c.history) as unknown;
      return Array.isArray(v) ? (v as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  private view(c: Candidate) {
    const { phoneNormalized: _p, history: _h, ...rest } = c;
    return { ...rest, history: this.history(c) };
  }

  private async owned(tenantId: string, id: string) {
    const [c] = await this.db
      .select()
      .from(jobCandidates)
      .where(and(eq(jobCandidates.id, id), eq(jobCandidates.tenantId, tenantId), isNull(jobCandidates.archivedAt)));
    if (!c) throw new NotFoundException('Nomzod topilmadi');
    return c;
  }

  async list(tenantId: string, query: QueryCandidatesDto) {
    const live = and(eq(jobCandidates.tenantId, tenantId), isNull(jobCandidates.archivedAt));
    const where: SQL[] = [live!];
    if (query.stage) where.push(eq(jobCandidates.stage, query.stage));
    const q = query.q?.trim();
    if (q) {
      const like = `%${q}%`;
      where.push(or(ilike(jobCandidates.fullName, like), ilike(jobCandidates.phone, like), ilike(jobCandidates.subject, like))!);
    }
    const [rows, counts] = await Promise.all([
      this.db.select().from(jobCandidates).where(and(...where)).orderBy(desc(jobCandidates.updatedAt)).limit(500),
      this.db.select({ stage: jobCandidates.stage, n: sql<number>`count(*)::int` }).from(jobCandidates).where(live).groupBy(jobCandidates.stage),
    ]);
    const byStage = Object.fromEntries(CANDIDATE_STAGES.map((s) => [s, 0])) as Record<CandidateStage, number>;
    for (const c of counts) if (c.stage in byStage) byStage[c.stage as CandidateStage] = c.n;
    return { items: rows.map((r) => this.view(r)), counts: byStage };
  }

  async get(tenantId: string, id: string) {
    const c = await this.owned(tenantId, id);
    const attempts = await this.db
      .select({
        id: placementAttempts.id,
        testId: placementAttempts.testId,
        testTitle: placementTests.title,
        percent: placementAttempts.percent,
        correct: placementAttempts.correct,
        total: placementAttempts.total,
        reviewStatus: placementAttempts.reviewStatus,
        createdAt: placementAttempts.createdAt,
      })
      .from(placementAttempts)
      .innerJoin(placementTests, eq(placementTests.id, placementAttempts.testId))
      .where(and(eq(placementAttempts.tenantId, tenantId), eq(placementAttempts.candidateId, id)))
      .orderBy(desc(placementAttempts.createdAt));
    return { ...this.view(c), attempts };
  }

  async create(tenantId: string, userId: string | null, dto: CreateCandidateDto, source?: string) {
    const [c] = await this.db
      .insert(jobCandidates)
      .values({
        tenantId,
        fullName: dto.fullName.trim(),
        phone: dto.phone?.trim() || null,
        phoneNormalized: normalizePhone(dto.phone),
        email: dto.email?.trim() || null,
        subject: dto.subject?.trim() || null,
        source: dto.source?.trim() || source || null,
        notes: dto.notes?.trim() || null,
        history: JSON.stringify([{ stage: 'NEW', at: new Date().toISOString(), by: userId }]),
        createdByUserId: userId,
      })
      .returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'job_candidate', entityId: c.id });
    return this.view(c);
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCandidateDto) {
    const c = await this.owned(tenantId, id);
    if (c.stage === 'HIRED' && dto.stage) throw new ConflictException("Nomzod allaqachon o'qituvchi bo'lgan");
    const patch: Partial<typeof jobCandidates.$inferInsert> = { updatedAt: new Date() };
    const text = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);
    if (dto.fullName !== undefined) patch.fullName = dto.fullName.trim();
    if (dto.phone !== undefined) {
      patch.phone = text(dto.phone);
      patch.phoneNormalized = normalizePhone(dto.phone);
    }
    for (const k of ['email', 'subject', 'source', 'notes', 'interviewNotes', 'demoNotes', 'decisionNote'] as const) {
      if (dto[k] !== undefined) patch[k] = text(dto[k]);
    }
    if (dto.testPercent !== undefined) patch.testPercent = dto.testPercent;
    if (dto.interviewScore !== undefined) patch.interviewScore = dto.interviewScore;
    if (dto.demoScore !== undefined) patch.demoScore = dto.demoScore;
    if (dto.interviewAt !== undefined) patch.interviewAt = new Date(dto.interviewAt);
    if (dto.demoAt !== undefined) patch.demoAt = new Date(dto.demoAt);
    if (dto.stage && dto.stage !== c.stage) {
      patch.stage = dto.stage;
      patch.history = JSON.stringify([...this.history(c), { stage: dto.stage, at: new Date().toISOString(), by: userId }]);
    }
    const [updated] = await this.db
      .update(jobCandidates)
      .set(patch)
      .where(and(eq(jobCandidates.id, id), eq(jobCandidates.tenantId, tenantId)))
      .returning();
    if (patch.stage) this.audit.log({ tenantId, userId, action: 'update', entityType: 'job_candidate', entityId: id, meta: { stage: patch.stage } });
    return this.view(updated);
  }

  /**
   * Makes the candidate a teacher: once (a second press returns the same
   * teacher), and only from a decision to hire or a passed demo lesson.
   */
  async hire(tenantId: string, userId: string, id: string) {
    const c = await this.owned(tenantId, id);
    if (c.teacherId) return { candidate: this.view(c), teacherId: c.teacherId };
    if (c.stage === 'REJECTED') throw new BadRequestException("Rad etilgan nomzodni o'qituvchi qilib bo'lmaydi");
    // Claimed first, so two presses at once make one teacher.
    const [claimed] = await this.db
      .update(jobCandidates)
      .set({ stage: 'HIRED', updatedAt: new Date(), history: JSON.stringify([...this.history(c), { stage: 'HIRED', at: new Date().toISOString(), by: userId }]) })
      .where(and(eq(jobCandidates.id, id), eq(jobCandidates.tenantId, tenantId), ne(jobCandidates.stage, 'HIRED'), isNull(jobCandidates.teacherId)))
      .returning({ id: jobCandidates.id });
    if (!claimed) throw new ConflictException("Nomzod hozirgina o'qituvchi qilindi");
    let teacherId: string;
    try {
      const teacher = (await this.teachers.create(tenantId, userId, {
        fullName: c.fullName,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        subject: c.subject ?? undefined,
        startDate: new Date().toISOString().slice(0, 10),
      })) as { id: string };
      teacherId = teacher.id;
    } catch (e) {
      // The teacher was not made (e.g. the plan's limit): back to where it was.
      await this.db.update(jobCandidates).set({ stage: c.stage, history: c.history, updatedAt: new Date() }).where(eq(jobCandidates.id, id));
      throw e;
    }
    const [updated] = await this.db.update(jobCandidates).set({ teacherId, updatedAt: new Date() }).where(eq(jobCandidates.id, id)).returning();
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'job_candidate', entityId: id, meta: { hired: teacherId } });
    return { candidate: this.view(updated), teacherId };
  }

  async archive(tenantId: string, userId: string, id: string) {
    await this.owned(tenantId, id);
    await this.db.update(jobCandidates).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(jobCandidates.id, id));
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'job_candidate', entityId: id });
    return { success: true };
  }

  /**
   * A candidate test was submitted (placement/, a CANDIDATE test): filed
   * under the candidate with that phone, or a new candidate. The score goes
   * on the card, and a new candidate moves to "test".
   */
  async recordTestAttempt(tenantId: string, a: { fullName: string; phone?: string | null; subject: string; attemptId: string; percent: number }) {
    const phone = normalizePhone(a.phone);
    let c: Candidate | undefined;
    if (phone) {
      [c] = await this.db
        .select()
        .from(jobCandidates)
        .where(and(eq(jobCandidates.tenantId, tenantId), eq(jobCandidates.phoneNormalized, phone), isNull(jobCandidates.archivedAt), ne(jobCandidates.stage, 'HIRED')))
        .orderBy(desc(jobCandidates.updatedAt))
        .limit(1);
    }
    const id = c?.id ?? (await this.create(tenantId, null, { fullName: a.fullName, phone: a.phone ?? undefined, subject: a.subject }, 'TEST')).id;
    const current = c ?? (await this.owned(tenantId, id));
    const toTest = current.stage === 'NEW';
    await this.db
      .update(jobCandidates)
      .set({
        testPercent: a.percent,
        testAttemptId: a.attemptId,
        updatedAt: new Date(),
        ...(toTest ? { stage: 'TEST', history: JSON.stringify([...this.history(current), { stage: 'TEST', at: new Date().toISOString(), by: null }]) } : {}),
      })
      .where(eq(jobCandidates.id, id));
    await this.db.update(placementAttempts).set({ candidateId: id }).where(eq(placementAttempts.id, a.attemptId));
    return id;
  }
}
