import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { placementAttempts, placementTests, tenants } from '../db/schema';
import { AiService } from '../ai/ai.service';
import { LeadsService } from '../leads/leads.service';
import { gradeAnswer, normalizeQuestion, publicQuestion, suggestLevel, type TestQuestion } from '../common/test-questions';
import { CreatePlacementTestDto, SubmitPlacementDto } from './placement.dto';

// Placement tests are saved and shared by link (/t/<token>) so a new
// student can take one on their own phone or computer; results come back
// to the center. Questions use the shared rich model; written answers
// (essays) wait for the teacher, with an AI-suggested score.
@Injectable()
export class PlacementService {
  private readonly logger = new Logger(PlacementService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
    private readonly leads: LeadsService,
  ) {}

  // Older tests stored a simpler format; normalizeQuestion reads both.
  private parse(test: { questions: string }): TestQuestion[] {
    try {
      const raw = JSON.parse(test.questions) as unknown[];
      return raw.map((q) => normalizeQuestion(q, { requireAnswer: false })).filter((q): q is TestQuestion => q !== null);
    } catch {
      return [];
    }
  }

  private json<T>(v: string | null, fallback: T): T {
    try {
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  async create(tenantId: string, userId: string, dto: CreatePlacementTestDto) {
    let questions: TestQuestion[];
    let source: 'ai' | 'bank' | 'manual' = 'manual';
    if (dto.questions) {
      questions = dto.questions.map((q) => normalizeQuestion(q)).filter((q): q is TestQuestion => q !== null);
      if (questions.length === 0) throw new BadRequestException("Testda to'g'ri javobi belgilangan savol yo'q");
      if (questions.length < dto.questions.length) {
        throw new BadRequestException(`${dto.questions.length - questions.length} ta savolning javobi yoki matni to'liq emas`);
      }
    } else {
      const generated = await this.ai.placementTest(tenantId, {
        subject: dto.subject, level: dto.level, groupId: dto.groupId, count: dto.count, language: dto.language,
      });
      questions = generated.questions;
      source = generated.source;
    }
    const [test] = await this.db.insert(placementTests).values({
      tenantId,
      createdByUserId: userId,
      title: dto.title?.trim() || dto.subject,
      subject: dto.subject,
      language: dto.language ?? 'UZ',
      questions: JSON.stringify(questions),
      token: randomBytes(9).toString('base64url'),
    }).returning();
    return { ...this.view(test), source, questions };
  }

  // Reads a PDF test for review. Questions without an answer come back with
  // an empty correctAnswer for the teacher to fill in. Levels follow the
  // order of the paper (first third easy ... last third hard).
  async parsePdf(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('PDF fayl yuklang');
    const parsed = await this.ai.extractQuestionsFromPdf(file.buffer);
    const third = Math.max(1, Math.ceil(parsed.length / 3));
    return {
      questions: parsed.map((q, i) => ({ ...q, level: q.level ?? (Math.min(3, Math.floor(i / third) + 1) as 1 | 2 | 3) })),
    };
  }

  private view(t: typeof placementTests.$inferSelect) {
    return { id: t.id, title: t.title, subject: t.subject, language: t.language, token: t.token, active: t.active, createdAt: t.createdAt };
  }

  async list(tenantId: string) {
    const rows = await this.db
      .select({
        test: placementTests,
        // Explicit aliases: inside a subquery drizzle would print bare column
        // names, and "id" would then bind to the attempts table.
        attempts: sql<number>`(select count(*)::int from placement_attempts pa where pa.test_id = "placement_tests"."id")`,
        pending: sql<number>`(select count(*)::int from placement_attempts pa where pa.test_id = "placement_tests"."id" and pa.review_status = 'PENDING')`,
      })
      .from(placementTests)
      .where(eq(placementTests.tenantId, tenantId))
      .orderBy(desc(placementTests.createdAt));
    return rows.map((r) => ({ ...this.view(r.test), questionCount: this.parse(r.test).length, attempts: r.attempts, pending: r.pending }));
  }

  private async owned(tenantId: string, id: string) {
    const [test] = await this.db.select().from(placementTests).where(and(eq(placementTests.id, id), eq(placementTests.tenantId, tenantId)));
    if (!test) throw new NotFoundException('Test topilmadi');
    return test;
  }

  async get(tenantId: string, id: string) {
    const test = await this.owned(tenantId, id);
    return { ...this.view(test), questions: this.parse(test) };
  }

  async rename(tenantId: string, id: string, title: string) {
    await this.owned(tenantId, id);
    const clean = title.trim();
    if (!clean) throw new BadRequestException('Nomini kiriting');
    const [t] = await this.db.update(placementTests).set({ title: clean.slice(0, 160) }).where(eq(placementTests.id, id)).returning();
    return this.view(t);
  }

  async attempts(tenantId: string, id: string) {
    await this.owned(tenantId, id);
    return this.db.select({
      id: placementAttempts.id,
      fullName: placementAttempts.fullName,
      phone: placementAttempts.phone,
      correct: placementAttempts.correct,
      total: placementAttempts.total,
      percent: placementAttempts.percent,
      suggestedLevel: placementAttempts.suggestedLevel,
      reviewStatus: placementAttempts.reviewStatus,
      leadId: placementAttempts.leadId,
      createdAt: placementAttempts.createdAt,
    }).from(placementAttempts)
      .where(and(eq(placementAttempts.testId, id), eq(placementAttempts.tenantId, tenantId)))
      .orderBy(desc(placementAttempts.createdAt));
  }

  async setActive(tenantId: string, id: string, active: boolean) {
    await this.owned(tenantId, id);
    const [t] = await this.db.update(placementTests).set({ active }).where(eq(placementTests.id, id)).returning();
    return this.view(t);
  }

  // Scores answers (by question position), with the teacher's points for
  // written answers when given.
  private score(questions: TestQuestion[], answers: string[], manual: Record<string, number> = {}) {
    const grades = questions.map((q, i) => {
      const g = gradeAnswer(q, answers[i]);
      const m = manual[String(i)];
      return m !== undefined ? { ...g, earned: Math.max(0, Math.min(q.points, m)), pending: false, correct: m >= q.points } : g;
    });
    const earned = grades.reduce((s, g) => s + g.earned, 0);
    const total = grades.reduce((s, g) => s + g.max, 0);
    return {
      grades,
      earned: Math.round(earned * 100) / 100,
      total,
      percent: total ? Math.round((earned / total) * 100) : 0,
      pending: grades.some((g) => g.pending),
      level: suggestLevel(questions, grades),
    };
  }

  // ---- public (link) ----

  private async byToken(token: string) {
    const [row] = await this.db.select({ test: placementTests, centerName: tenants.name, tenantStatus: tenants.status })
      .from(placementTests).innerJoin(tenants, eq(tenants.id, placementTests.tenantId))
      .where(eq(placementTests.token, token));
    if (!row || !row.test.active || row.tenantStatus === 'SUSPENDED') throw new NotFoundException('Test topilmadi yoki yopilgan');
    return row;
  }

  // Questions without the answers.
  async publicGet(token: string) {
    const { test, centerName } = await this.byToken(token);
    return {
      title: test.title,
      subject: test.subject,
      language: test.language,
      centerName,
      questions: this.parse(test).map((q, i) => publicQuestion(q, i)),
    };
  }

  async publicSubmit(token: string, dto: SubmitPlacementDto) {
    const { test } = await this.byToken(token);
    const questions = this.parse(test);
    const answers = questions.map((_, i) => dto.answers[i] ?? '');
    const r = this.score(questions, answers);
    const [attempt] = await this.db.insert(placementAttempts).values({
      tenantId: test.tenantId,
      testId: test.id,
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || null,
      answers: JSON.stringify(answers),
      correct: Math.round(r.earned),
      total: r.total,
      percent: r.percent,
      suggestedLevel: r.level,
      reviewStatus: r.pending ? 'PENDING' : 'DONE',
    }).returning({ id: placementAttempts.id });
    // File the applicant under admissions. A failure here must not lose the
    // result the student just submitted.
    try {
      const leadId = await this.leads.recordPlacementAttempt(test.tenantId, {
        fullName: dto.fullName.trim(), phone: dto.phone, subject: test.subject, testTitle: test.title,
        attemptId: attempt.id, percent: r.percent, level: r.level, pending: r.pending,
      });
      if (leadId) await this.db.update(placementAttempts).set({ leadId }).where(eq(placementAttempts.id, attempt.id));
    } catch (err) {
      this.logger.warn(`Placement attempt ${attempt.id} not filed as a lead: ${(err as Error).message}`);
    }
    return { correct: r.earned, total: r.total, percent: r.percent, suggestedLevel: r.level, pending: r.pending };
  }

  // ---- teacher review ----

  private async attemptRow(tenantId: string, testId: string, attemptId: string) {
    const [a] = await this.db.select().from(placementAttempts)
      .where(and(eq(placementAttempts.id, attemptId), eq(placementAttempts.testId, testId), eq(placementAttempts.tenantId, tenantId)));
    if (!a) throw new NotFoundException('Natija topilmadi');
    return a;
  }

  async getAttempt(tenantId: string, testId: string, attemptId: string) {
    const test = await this.owned(tenantId, testId);
    const a = await this.attemptRow(tenantId, testId, attemptId);
    const questions = this.parse(test);
    const answers = this.json<string[]>(a.answers, []);
    const manual = this.json<Record<string, number>>(a.manualScores, {});
    const r = this.score(questions, answers, manual);
    return {
      id: a.id,
      fullName: a.fullName,
      phone: a.phone,
      createdAt: a.createdAt,
      reviewStatus: a.reviewStatus,
      percent: r.percent,
      earned: r.earned,
      total: r.total,
      suggestedLevel: r.level,
      manualScores: manual,
      aiReview: this.json<Record<string, { score: number; comment: string }>>(a.aiReview, {}),
      items: questions.map((q, i) => ({ question: q, answer: answers[i] ?? '', ...r.grades[i] })),
    };
  }

  async gradeAttempt(tenantId: string, testId: string, attemptId: string, scores: Record<string, number>) {
    const test = await this.owned(tenantId, testId);
    const a = await this.attemptRow(tenantId, testId, attemptId);
    const questions = this.parse(test);
    const manual = { ...this.json<Record<string, number>>(a.manualScores, {}) };
    for (const [k, v] of Object.entries(scores ?? {})) {
      if (questions[Number(k)] && Number.isFinite(Number(v))) manual[k] = Number(v);
    }
    const r = this.score(questions, this.json<string[]>(a.answers, []), manual);
    await this.db.update(placementAttempts).set({
      manualScores: JSON.stringify(manual),
      correct: Math.round(r.earned),
      total: r.total,
      percent: r.percent,
      suggestedLevel: r.level,
      reviewStatus: r.pending ? 'PENDING' : 'DONE',
    }).where(eq(placementAttempts.id, attemptId));
    return this.getAttempt(tenantId, testId, attemptId);
  }

  async aiReviewAttempt(tenantId: string, testId: string, attemptId: string) {
    const test = await this.owned(tenantId, testId);
    const a = await this.attemptRow(tenantId, testId, attemptId);
    const questions = this.parse(test);
    const answers = this.json<string[]>(a.answers, []);
    const review: Record<string, { score: number; comment: string }> = {};
    for (const [i, q] of questions.entries()) {
      if (q.type !== 'ESSAY') continue;
      review[String(i)] = await this.ai.gradeEssay({ prompt: q.prompt, rubric: q.rubric, answer: answers[i] ?? '', maxPoints: q.points });
    }
    await this.db.update(placementAttempts).set({ aiReview: JSON.stringify(review) }).where(eq(placementAttempts.id, attemptId));
    return this.getAttempt(tenantId, testId, attemptId);
  }
}
