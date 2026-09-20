import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { exams, examResults } from '../db/schema';
import { CreateExamDto, SubmitResultsDto } from './dto/exam.dto';

@Injectable()
export class ExamsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string, groupId?: string) {
    const conditions = [eq(exams.tenantId, tenantId)];
    if (groupId) conditions.push(eq(exams.groupId, groupId));
    return this.db.query.exams.findMany({
      where: and(...conditions),
      with: { group: true, results: { with: { student: true } } },
      orderBy: (e, { desc }) => desc(e.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const exam = await this.db.query.exams.findFirst({
      where: and(eq(exams.id, id), eq(exams.tenantId, tenantId)),
      with: { group: true, results: { with: { student: true } } },
    });
    if (!exam) throw new NotFoundException('Imtihon topilmadi');
    return exam;
  }

  async create(tenantId: string, dto: CreateExamDto) {
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
    await this.findOne(tenantId, examId);
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
    return rows.flat();
  }

  async remove(tenantId: string, id: string) {
    const exam = await this.findOne(tenantId, id);
    if (exam.materialPath) {
      await unlink(join(__dirname, '..', '..', 'uploads', exam.materialPath)).catch(() => undefined);
    }
    await this.db.delete(exams).where(and(eq(exams.id, id), eq(exams.tenantId, tenantId)));
    return { success: true };
  }
}
