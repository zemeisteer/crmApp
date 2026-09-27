import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { placementAttempts, placementTests, tenants } from '../db/schema';
import { AiService, normalizePlacementQuestions } from '../ai/ai.service';
import { isCorrect, suggestLevel, type PlacementQuestion } from '../ai/placement-bank';
import { CreatePlacementTestDto, SubmitPlacementDto } from './placement.dto';

// Placement tests are saved and shared by link (/t/<token>) so a new
// student can take one on their own phone or computer; results come back
// to the center.
@Injectable()
export class PlacementService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  private parse(test: { questions: string }): PlacementQuestion[] {
    try {
      return JSON.parse(test.questions) as PlacementQuestion[];
    } catch {
      return [];
    }
  }

  async create(tenantId: string, userId: string, dto: CreatePlacementTestDto) {
    let questions: PlacementQuestion[];
    let source: 'ai' | 'bank' | 'manual' = 'manual';
    if (dto.questions) {
      questions = normalizePlacementQuestions(dto.questions);
      if (questions.length === 0) throw new BadRequestException("Testda to'g'ri javobi belgilangan savol yo'q");
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

  // Reads a PDF test into placement questions for review. Questions
  // without an answer come back with correctIndex null / answer ''.
  async parsePdf(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('PDF fayl yuklang');
    const parsed = await this.ai.extractQuestionsFromPdf(file.buffer);
    const third = Math.max(1, Math.ceil(parsed.length / 3));
    return {
      questions: parsed.map((q, i) => {
        const level = (Math.min(3, Math.floor(i / third) + 1)) as 1 | 2 | 3;
        if (q.questionType === 'SHORT_ANSWER') {
          return { type: 'SHORT_ANSWER' as const, prompt: q.prompt, options: [], answer: q.correctAnswer ?? '', level };
        }
        const idx = q.options.findIndex((o) => o.id.toLowerCase() === (q.correctAnswer ?? '').toLowerCase());
        return {
          type: q.questionType === 'TRUE_FALSE' ? ('TRUE_FALSE' as const) : ('MCQ' as const),
          prompt: q.prompt,
          options: q.options.map((o) => o.text),
          correctIndex: idx >= 0 ? idx : null,
          level,
        };
      }),
    };
  }

  private view(t: typeof placementTests.$inferSelect) {
    return { id: t.id, title: t.title, subject: t.subject, language: t.language, token: t.token, active: t.active, createdAt: t.createdAt };
  }

  async list(tenantId: string) {
    const rows = await this.db
      .select({
        test: placementTests,
        attempts: sql<number>`(select count(*)::int from ${placementAttempts} where ${placementAttempts.testId} = ${placementTests.id})`,
      })
      .from(placementTests)
      .where(eq(placementTests.tenantId, tenantId))
      .orderBy(desc(placementTests.createdAt));
    return rows.map((r) => ({ ...this.view(r.test), questionCount: this.parse(r.test).length, attempts: r.attempts }));
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
      questions: this.parse(test).map((q) => ({ type: q.type, prompt: q.prompt, options: q.options })),
    };
  }

  async publicSubmit(token: string, dto: SubmitPlacementDto) {
    const { test } = await this.byToken(token);
    const questions = this.parse(test);
    const answers = questions.map((_, i) => dto.answers[i] ?? '');
    const correct = questions.filter((q, i) => isCorrect(q, answers[i])).length;
    const total = questions.length;
    const percent = total ? Math.round((correct / total) * 100) : 0;
    const level = suggestLevel(questions, answers);
    await this.db.insert(placementAttempts).values({
      tenantId: test.tenantId,
      testId: test.id,
      fullName: dto.fullName.trim(),
      phone: dto.phone?.trim() || null,
      answers: JSON.stringify(answers),
      correct,
      total,
      percent,
      suggestedLevel: level,
    });
    return { correct, total, percent, suggestedLevel: level };
  }
}
