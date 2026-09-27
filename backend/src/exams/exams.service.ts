import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { exams, examResults, examQuestions, examAttempts, groups, students } from '../db/schema';
import {
  CreateExamDto,
  CreateExamQuestionDto,
  BatchCreateQuestionsDto,
  SubmitAttemptDto,
  SubmitResultsDto,
} from './dto/exam.dto';
import { TelegramService } from '../telegram/telegram.service';
import { AiService } from '../ai/ai.service';
import { gradeAnswer, normalizeQuestion, publicQuestion, type TestQuestion } from '../common/test-questions';

@Injectable()
export class ExamsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly ai: AiService,
  ) {}

  findAll(tenantId: string, groupId?: string) {
    const conditions = [eq(exams.tenantId, tenantId)];
    if (groupId) conditions.push(eq(exams.groupId, groupId));
    return this.db.query.exams.findMany({
      where: and(...conditions),
      with: {
        group: true,
        results: { with: { student: true } },
        questions: true,
        attempts: { with: { student: true } },
      },
      orderBy: (e, { desc }) => desc(e.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const exam = await this.db.query.exams.findFirst({
      where: and(eq(exams.id, id), eq(exams.tenantId, tenantId)),
      with: {
        group: true,
        results: { with: { student: true } },
        questions: { orderBy: [asc(examQuestions.order), asc(examQuestions.createdAt)] },
        attempts: { with: { student: true }, orderBy: [desc(examAttempts.createdAt)] },
      },
    });
    if (!exam) throw new NotFoundException('Imtihon topilmadi');
    return exam;
  }

  async create(tenantId: string, dto: CreateExamDto) {
    if (dto.groupIds.length > 0) {
      const validGroups = await this.db.query.groups.findMany({
        where: and(inArray(groups.id, dto.groupIds), eq(groups.tenantId, tenantId)),
      });
      if (validGroups.length !== dto.groupIds.length) {
        throw new BadRequestException('Ayrim guruhlar sizning markazingizga tegishli emas');
      }
    }

    const rows = await Promise.all(
      dto.groupIds.map((groupId) =>
        this.db
          .insert(exams)
          .values({
            tenantId,
            groupId,
            title: dto.title,
            description: dto.description,
            maxScore: dto.maxScore ?? 100,
            passingScore: dto.passingScore,
            durationMinutes: dto.durationMinutes,
            examDate: dto.examDate ? new Date(dto.examDate) : undefined,
          })
          .returning(),
      ),
    );
    return rows.flat();
  }

  async attachMaterial(tenantId: string, id: string, file: Express.Multer.File) {
    await this.findOne(tenantId, id);
    const [exam] = await this.db
      .update(exams)
      .set({ materialPath: file.filename, materialName: file.originalname })
      .where(and(eq(exams.id, id), eq(exams.tenantId, tenantId)))
      .returning();
    return exam;
  }

  async submitResults(tenantId: string, examId: string, dto: SubmitResultsDto) {
    const exam = await this.findOne(tenantId, examId);
    if (dto.results.length > 0) {
      const studentIds = dto.results.map((r) => r.studentId);
      const validStudents = await this.db.query.students.findMany({
        where: and(inArray(students.id, studentIds), eq(students.tenantId, tenantId)),
      });
      if (validStudents.length !== new Set(studentIds).size) {
        throw new BadRequestException("Ayrim o'quvchilar sizning markazingizga tegishli emas");
      }
    }

    const rows = await Promise.all(
      dto.results.map((r) =>
        this.db
          .insert(examResults)
          .values({ examId, studentId: r.studentId, score: r.score, note: r.note })
          .onConflictDoUpdate({
            target: [examResults.examId, examResults.studentId],
            set: { score: r.score, note: r.note },
          })
          .returning(),
      ),
    );
    const flat = rows.flat();

    for (const r of flat) {
      void this.telegram.notifyExamResult(
        r.studentId,
        exam.title,
        r.score,
        exam.maxScore,
        r.note || undefined,
      );
    }

    return flat;
  }

  async remove(tenantId: string, id: string) {
    const exam = await this.findOne(tenantId, id);
    if (exam.materialPath) {
      await unlink(join(__dirname, '..', '..', 'uploads', exam.materialPath)).catch(() => undefined);
    }
    await this.db.delete(exams).where(and(eq(exams.id, id), eq(exams.tenantId, tenantId)));
    return { success: true };
  }

  // ---- Questions & Question Bank (Section 21) ----
  // Stored with the rich question model (common/test-questions.ts):
  // section/instruction/passage columns, type-specific extras in `meta`.

  private toRow(tenantId: string, examId: string, q: TestQuestion, order: number) {
    return {
      tenantId,
      examId,
      prompt: q.prompt,
      questionType: q.type,
      options: JSON.stringify(q.options ?? []),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation ?? null,
      points: q.points,
      order,
      section: q.section ?? null,
      instruction: q.instruction ?? null,
      passage: q.passage ?? null,
      meta: JSON.stringify({ pairs: q.pairs, words: q.words, rubric: q.rubric }),
    };
  }

  private fromRow(row: typeof examQuestions.$inferSelect): TestQuestion & { id: string; order: number } {
    const parse = <T>(v: string | null, fallback: T): T => {
      try {
        return v ? (JSON.parse(v) as T) : fallback;
      } catch {
        return fallback;
      }
    };
    const meta = parse<{ pairs?: TestQuestion['pairs']; words?: string[]; rubric?: string | null }>(row.meta, {});
    return {
      id: row.id,
      order: row.order,
      type: row.questionType as TestQuestion['type'],
      prompt: row.prompt,
      section: row.section,
      instruction: row.instruction,
      passage: row.passage,
      options: parse(row.options, []),
      correctAnswer: row.correctAnswer,
      pairs: meta.pairs,
      words: meta.words,
      rubric: meta.rubric ?? null,
      explanation: row.explanation,
      points: row.points,
    };
  }

  private cleanOrThrow(raw: unknown, index: number): TestQuestion {
    const q = normalizeQuestion(raw);
    if (!q) throw new BadRequestException(`${index + 1}-savol to'liq emas: matni, turi va to'g'ri javobini tekshiring`);
    return q;
  }

  async getQuestions(tenantId: string, examId: string) {
    await this.findOne(tenantId, examId);
    const rows = await this.db.query.examQuestions.findMany({
      where: and(eq(examQuestions.tenantId, tenantId), eq(examQuestions.examId, examId)),
      orderBy: [asc(examQuestions.order), asc(examQuestions.createdAt)],
    });
    return rows.map((r) => this.fromRow(r));
  }

  private async nextOrder(examId: string) {
    const rows = await this.db.select({ order: examQuestions.order }).from(examQuestions).where(eq(examQuestions.examId, examId));
    return rows.reduce((m, r) => Math.max(m, r.order + 1), 0);
  }

  async createQuestion(tenantId: string, examId: string, dto: CreateExamQuestionDto) {
    await this.findOne(tenantId, examId);
    const q = this.cleanOrThrow(dto, 0);
    const [row] = await this.db.insert(examQuestions).values(this.toRow(tenantId, examId, q, dto.order ?? (await this.nextOrder(examId)))).returning();
    return this.fromRow(row);
  }

  async batchCreateQuestions(tenantId: string, examId: string, dto: BatchCreateQuestionsDto) {
    await this.findOne(tenantId, examId);
    if (dto.questions.length === 0) return [];
    const start = await this.nextOrder(examId);
    const values = dto.questions.map((raw, i) => this.toRow(tenantId, examId, this.cleanOrThrow(raw, i), start + i));
    const rows = await this.db.insert(examQuestions).values(values).returning();
    return rows.map((r) => this.fromRow(r));
  }

  async removeQuestion(tenantId: string, examId: string, questionId: string) {
    await this.findOne(tenantId, examId);
    await this.db
      .delete(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.tenantId, tenantId)));
    return { success: true };
  }

  // Reads a PDF for review; nothing is saved until the teacher confirms.
  async parseTextQuestions(tenantId: string, examId: string, text: string) {
    await this.findOne(tenantId, examId);
    return { questions: await this.ai.extractQuestionsFromText(text) };
  }

  async parsePdfQuestions(tenantId: string, examId: string, file?: Express.Multer.File) {
    await this.findOne(tenantId, examId);
    if (!file?.buffer?.length) throw new BadRequestException('PDF fayl yuklang');
    const questions = await this.ai.extractQuestionsFromPdf(file.buffer);
    return { questions };
  }

  async generateQuestionsWithAi(tenantId: string, examId: string, opts: { count?: number; request?: string } = {}) {
    const exam = await this.findOne(tenantId, examId);
    const generated = await this.ai.generateExamQuestions({
      subject: exam.group?.subject || 'Umumiy',
      topic: exam.title + (exam.description ? ` — ${exam.description}` : ''),
      level: exam.group?.level ?? null,
      count: opts.count ?? 5,
      request: opts.request ?? null,
    });
    return this.batchCreateQuestions(tenantId, examId, { questions: generated as unknown as CreateExamQuestionDto[] });
  }

  // ---- Interactive Test Taking & Auto Grading (Section 21) ----

  async startAttempt(tenantId: string, examId: string, studentId: string) {
    const exam = await this.findOne(tenantId, examId);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    const questions = await this.getQuestions(tenantId, examId);
    if (questions.length === 0) {
      throw new BadRequestException("Ushbu imtihonga hali savollar kiritilmagan");
    }

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.durationMinutes,
        maxScore: exam.maxScore,
        passingScore: exam.passingScore,
        questionCount: questions.length,
      },
      student: { id: student.id, fullName: student.fullName },
      // No answers leave the server before the attempt is submitted.
      questions: questions.map((q, i) => ({ id: q.id, order: q.order, ...publicQuestion(q, i) })),
    };
  }

  // Grades every question; essays wait for the teacher (score counts the
  // rest until then). `manual` overrides per question (teacher review).
  private score(
    exam: { maxScore: number; passingScore: number | null },
    questions: Array<TestQuestion & { id: string }>,
    answers: Record<string, string>,
    manual: Record<string, number> = {},
  ) {
    let earnedPoints = 0;
    let totalPoints = 0;
    let pending = false;
    const breakdown = questions.map((q) => {
      const g = gradeAnswer(q, answers[q.id]);
      const manualScore = manual[q.id];
      const earned = manualScore !== undefined ? Math.max(0, Math.min(q.points, manualScore)) : g.earned;
      const isPending = g.pending && manualScore === undefined;
      if (isPending) pending = true;
      totalPoints += q.points;
      earnedPoints += earned;
      return {
        questionId: q.id,
        prompt: q.prompt,
        questionType: q.type,
        section: q.section ?? null,
        instruction: q.instruction ?? null,
        passage: q.passage ?? null,
        options: q.options ?? [],
        pairs: q.pairs ?? null,
        words: q.words ?? null,
        rubric: q.rubric ?? null,
        studentAnswer: answers[q.id] || '',
        correctAnswer: q.correctAnswer,
        isCorrect: isPending ? false : earned >= q.points,
        pending: isPending,
        points: q.points,
        earned: Math.round(earned * 100) / 100,
        explanation: q.explanation ?? null,
      };
    });
    const calculatedScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * exam.maxScore) : 0;
    const passing = exam.passingScore ?? Math.round(exam.maxScore * 0.6);
    return {
      breakdown,
      earnedPoints: Math.round(earnedPoints * 100) / 100,
      totalPoints,
      pending,
      score: calculatedScore,
      passed: calculatedScore >= passing,
      passing,
    };
  }

  private async saveResult(examId: string, studentId: string, score: number, note: string) {
    await this.db
      .insert(examResults)
      .values({ examId, studentId, score, note })
      .onConflictDoUpdate({ target: [examResults.examId, examResults.studentId], set: { score, note } });
  }

  async submitAttempt(tenantId: string, examId: string, dto: SubmitAttemptDto) {
    const exam = await this.findOne(tenantId, examId);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    const questions = await this.getQuestions(tenantId, examId);
    if (questions.length === 0) {
      throw new BadRequestException("Imtihon savollari topilmadi");
    }
    const r = this.score(exam, questions, dto.answers);

    const [attempt] = await this.db
      .insert(examAttempts)
      .values({
        tenantId,
        examId,
        studentId: dto.studentId,
        completedAt: new Date(),
        score: r.score,
        maxScore: exam.maxScore,
        passed: r.passed,
        answers: JSON.stringify(dto.answers),
        reviewStatus: r.pending ? 'PENDING' : 'DONE',
      })
      .returning();

    const pct = Math.round((r.score / exam.maxScore) * 100);
    await this.saveResult(examId, dto.studentId, r.score, `Onlayn test: ${r.earnedPoints}/${r.totalPoints} ball (${pct}%)${r.pending ? ' — yozma javoblar tekshirilmoqda' : ''}`);

    if (!r.pending) {
      void this.telegram.notifyExamResult(
        dto.studentId, exam.title, r.score, exam.maxScore,
        r.passed ? `✅ Onlayn testdan o'tdi (${pct}%)` : `❌ O'tish bali: ${r.passing}`,
      );
    }

    return {
      attempt,
      score: r.score,
      maxScore: exam.maxScore,
      earnedPoints: r.earnedPoints,
      totalPoints: r.totalPoints,
      passed: r.passed,
      pending: r.pending,
      percentage: pct,
      breakdown: r.breakdown,
    };
  }

  async getAttempts(tenantId: string, examId: string) {
    await this.findOne(tenantId, examId);
    return this.db.query.examAttempts.findMany({
      where: and(eq(examAttempts.tenantId, tenantId), eq(examAttempts.examId, examId)),
      with: { student: true },
      orderBy: [desc(examAttempts.createdAt)],
    });
  }

  // ---- Teacher review of written answers ----

  private async attemptRow(tenantId: string, examId: string, attemptId: string) {
    const attempt = await this.db.query.examAttempts.findFirst({
      where: and(eq(examAttempts.id, attemptId), eq(examAttempts.examId, examId), eq(examAttempts.tenantId, tenantId)),
      with: { student: true },
    });
    if (!attempt) throw new NotFoundException('Urinish topilmadi');
    return attempt;
  }

  private parseJson<T>(v: string | null, fallback: T): T {
    try {
      return v ? (JSON.parse(v) as T) : fallback;
    } catch {
      return fallback;
    }
  }

  async getAttempt(tenantId: string, examId: string, attemptId: string) {
    const exam = await this.findOne(tenantId, examId);
    const attempt = await this.attemptRow(tenantId, examId, attemptId);
    const questions = await this.getQuestions(tenantId, examId);
    const manual = this.parseJson<Record<string, number>>(attempt.manualScores, {});
    const r = this.score(exam, questions, this.parseJson(attempt.answers, {}), manual);
    return {
      id: attempt.id,
      student: { id: attempt.student?.id, fullName: attempt.student?.fullName },
      createdAt: attempt.createdAt,
      reviewStatus: attempt.reviewStatus,
      score: attempt.score,
      maxScore: attempt.maxScore,
      passed: attempt.passed,
      earnedPoints: r.earnedPoints,
      totalPoints: r.totalPoints,
      manualScores: manual,
      aiReview: this.parseJson<Record<string, { score: number; comment: string }>>(attempt.aiReview, {}),
      breakdown: r.breakdown,
    };
  }

  // Teacher sets points for written answers (and may override any
  // question); the attempt, the exam result and the student are updated.
  async gradeAttempt(tenantId: string, examId: string, attemptId: string, scores: Record<string, number>) {
    const exam = await this.findOne(tenantId, examId);
    const attempt = await this.attemptRow(tenantId, examId, attemptId);
    const questions = await this.getQuestions(tenantId, examId);
    const valid = new Set(questions.map((q) => q.id));
    const manual = { ...this.parseJson<Record<string, number>>(attempt.manualScores, {}) };
    for (const [id, v] of Object.entries(scores ?? {})) {
      if (valid.has(id) && Number.isFinite(Number(v))) manual[id] = Number(v);
    }
    const r = this.score(exam, questions, this.parseJson(attempt.answers, {}), manual);
    await this.db.update(examAttempts).set({
      manualScores: JSON.stringify(manual),
      score: r.score,
      passed: r.passed,
      reviewStatus: r.pending ? 'PENDING' : 'DONE',
    }).where(eq(examAttempts.id, attemptId));
    const pct = Math.round((r.score / exam.maxScore) * 100);
    await this.saveResult(examId, attempt.studentId, r.score, `Onlayn test: ${r.earnedPoints}/${r.totalPoints} ball (${pct}%)`);
    if (!r.pending && attempt.reviewStatus === 'PENDING') {
      void this.telegram.notifyExamResult(
        attempt.studentId, exam.title, r.score, exam.maxScore,
        r.passed ? `✅ Imtihondan o'tdi (${pct}%)` : `❌ O'tish bali: ${r.passing}`,
      );
    }
    return this.getAttempt(tenantId, examId, attemptId);
  }

  // AI suggests points and a comment for each written answer; the teacher
  // decides (nothing is applied automatically).
  async aiReviewAttempt(tenantId: string, examId: string, attemptId: string) {
    await this.findOne(tenantId, examId);
    const attempt = await this.attemptRow(tenantId, examId, attemptId);
    const questions = await this.getQuestions(tenantId, examId);
    const answers = this.parseJson<Record<string, string>>(attempt.answers, {});
    const review: Record<string, { score: number; comment: string }> = {};
    for (const q of questions.filter((x) => x.type === 'ESSAY')) {
      review[q.id] = await this.ai.gradeEssay({ prompt: q.prompt, rubric: q.rubric, answer: answers[q.id] ?? '', maxPoints: q.points });
    }
    await this.db.update(examAttempts).set({ aiReview: JSON.stringify(review) }).where(eq(examAttempts.id, attemptId));
    return this.getAttempt(tenantId, examId, attemptId);
  }
}
