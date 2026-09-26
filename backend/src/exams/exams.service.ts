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

  async getQuestions(tenantId: string, examId: string) {
    await this.findOne(tenantId, examId);
    return this.db.query.examQuestions.findMany({
      where: and(eq(examQuestions.tenantId, tenantId), eq(examQuestions.examId, examId)),
      orderBy: [asc(examQuestions.order), asc(examQuestions.createdAt)],
    });
  }

  async createQuestion(tenantId: string, examId: string, dto: CreateExamQuestionDto) {
    await this.findOne(tenantId, examId);
    const optionsStr = typeof dto.options === 'string' ? dto.options : JSON.stringify(dto.options || []);
    const [q] = await this.db
      .insert(examQuestions)
      .values({
        tenantId,
        examId,
        prompt: dto.prompt,
        questionType: dto.questionType || 'MCQ',
        options: optionsStr,
        correctAnswer: dto.correctAnswer,
        explanation: dto.explanation,
        points: dto.points || 1,
        order: dto.order || 0,
      })
      .returning();
    return q;
  }

  async batchCreateQuestions(tenantId: string, examId: string, dto: BatchCreateQuestionsDto) {
    await this.findOne(tenantId, examId);
    const values = dto.questions.map((q, idx) => ({
      tenantId,
      examId,
      prompt: q.prompt,
      questionType: q.questionType || 'MCQ',
      options: typeof q.options === 'string' ? q.options : JSON.stringify(q.options || []),
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      points: q.points || 1,
      order: q.order ?? idx,
    }));
    return this.db.insert(examQuestions).values(values).returning();
  }

  async removeQuestion(tenantId: string, examId: string, questionId: string) {
    await this.findOne(tenantId, examId);
    await this.db
      .delete(examQuestions)
      .where(and(eq(examQuestions.id, questionId), eq(examQuestions.tenantId, tenantId)));
    return { success: true };
  }

  async parsePdfQuestions(tenantId: string, examId: string, file?: Express.Multer.File) {
    await this.findOne(tenantId, examId);
    if (!file?.buffer?.length) throw new BadRequestException('PDF fayl yuklang');
    const questions = await this.ai.extractQuestionsFromPdf(file.buffer);
    return { questions };
  }

  async generateQuestionsWithAi(tenantId: string, examId: string) {
    const exam = await this.findOne(tenantId, examId);
    const generated = await this.ai.generateExamQuestions(
      exam.title,
      exam.group?.subject || exam.description || undefined,
      5,
    );

    const created = await this.batchCreateQuestions(tenantId, examId, {
      questions: generated.map((g, idx) => ({
        prompt: g.prompt,
        questionType: g.questionType,
        options: g.options,
        correctAnswer: g.correctAnswer,
        explanation: g.explanation,
        points: g.points,
        order: idx,
      })),
    });

    return created;
  }

  // ---- Interactive Test Taking & Auto Grading (Section 21) ----

  async startAttempt(tenantId: string, examId: string, studentId: string) {
    const exam = await this.findOne(tenantId, examId);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    const rawQuestions = await this.getQuestions(tenantId, examId);
    if (rawQuestions.length === 0) {
      throw new BadRequestException("Ushbu imtihonga hali savollar kiritilmagan");
    }

    // Sanitize questions: strip correctAnswer and explanation to prevent student client inspection
    const sanitizedQuestions = rawQuestions.map((q) => {
      let parsedOptions = [];
      try {
        parsedOptions = q.options ? JSON.parse(q.options) : [];
      } catch {
        parsedOptions = [];
      }
      return {
        id: q.id,
        prompt: q.prompt,
        questionType: q.questionType,
        options: parsedOptions,
        points: q.points,
        order: q.order,
      };
    });

    return {
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        durationMinutes: exam.durationMinutes,
        maxScore: exam.maxScore,
        passingScore: exam.passingScore,
        questionCount: sanitizedQuestions.length,
      },
      student: {
        id: student.id,
        fullName: student.fullName,
      },
      questions: sanitizedQuestions,
    };
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

    let earnedPoints = 0;
    let totalPoints = 0;

    const breakdown = questions.map((q) => {
      const studentAns = (dto.answers[q.id] || '').trim().toLowerCase();
      const correctAns = (q.correctAnswer || '').trim().toLowerCase();
      const isCorrect = studentAns.length > 0 && studentAns === correctAns;
      totalPoints += q.points;
      if (isCorrect) earnedPoints += q.points;

      let parsedOptions = [];
      try {
        parsedOptions = q.options ? JSON.parse(q.options) : [];
      } catch {
        parsedOptions = [];
      }

      return {
        questionId: q.id,
        prompt: q.prompt,
        questionType: q.questionType,
        options: parsedOptions,
        studentAnswer: dto.answers[q.id] || '',
        correctAnswer: q.correctAnswer,
        isCorrect,
        points: q.points,
        earned: isCorrect ? q.points : 0,
        explanation: q.explanation,
      };
    });

    // Score proportional to exam.maxScore
    const calculatedScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * exam.maxScore) : 0;
    const passing = exam.passingScore ?? Math.round(exam.maxScore * 0.6);
    const passed = calculatedScore >= passing;

    // 1. Save attempt record
    const [attempt] = await this.db
      .insert(examAttempts)
      .values({
        tenantId,
        examId,
        studentId: dto.studentId,
        completedAt: new Date(),
        score: calculatedScore,
        maxScore: exam.maxScore,
        passed,
        answers: JSON.stringify(dto.answers),
      })
      .returning();

    // 2. Automatically record / update in examResults table
    await this.db
      .insert(examResults)
      .values({
        examId,
        studentId: dto.studentId,
        score: calculatedScore,
        note: `Onlayn test: ${earnedPoints}/${totalPoints} to'g'ri (${Math.round((calculatedScore / exam.maxScore) * 100)}%)`,
      })
      .onConflictDoUpdate({
        target: [examResults.examId, examResults.studentId],
        set: {
          score: calculatedScore,
          note: `Onlayn test: ${earnedPoints}/${totalPoints} to'g'ri (${Math.round((calculatedScore / exam.maxScore) * 100)}%)`,
        },
      });

    // 3. Send Telegram notification to student/parent
    void this.telegram.notifyExamResult(
      dto.studentId,
      exam.title,
      calculatedScore,
      exam.maxScore,
      passed
        ? `✅ Onlayn testdan o'tdi (${Math.round((calculatedScore / exam.maxScore) * 100)}%)`
        : `❌ O'tish bali: ${passing}`,
    );

    return {
      attempt,
      score: calculatedScore,
      maxScore: exam.maxScore,
      earnedPoints,
      totalPoints,
      passed,
      percentage: Math.round((calculatedScore / exam.maxScore) * 100),
      breakdown,
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
}
