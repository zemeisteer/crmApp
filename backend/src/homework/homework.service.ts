import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { homework, homeworkCompletions, enrollments } from '../db/schema';
import { CreateHomeworkDto, UpdateHomeworkDto, SetCompletionDto } from './dto/homework.dto';

@Injectable()
export class HomeworkService {
  constructor(@Inject(DB) private readonly db: Database) {}

  findAll(tenantId: string, groupId?: string) {
    const conditions = [eq(homework.tenantId, tenantId)];
    if (groupId) conditions.push(eq(homework.groupId, groupId));
    return this.db.query.homework.findMany({
      where: and(...conditions),
      with: { group: true, completions: true },
      orderBy: (h, { desc }) => desc(h.createdAt),
    });
  }

  async findOne(tenantId: string, id: string) {
    const hw = await this.db.query.homework.findFirst({
      where: and(eq(homework.id, id), eq(homework.tenantId, tenantId)),
      with: { group: true, completions: { with: { student: true } } },
    });
    if (!hw) throw new NotFoundException('Uy vazifasi topilmadi');
    return hw;
  }

  // The homework's group's enrolled students, each with their completion
  // status (defaulting to not-completed when no row exists yet).
  async getRoster(tenantId: string, id: string) {
    const hw = await this.findOne(tenantId, id);
    const enrolled = await this.db.query.enrollments.findMany({
      where: eq(enrollments.groupId, hw.groupId),
      with: { student: true },
    });
    const completedIds = new Set(hw.completions.filter((c) => c.completed).map((c) => c.studentId));
    return enrolled.map((e) => ({ student: e.student, completed: completedIds.has(e.studentId) }));
  }

  async setCompletion(tenantId: string, id: string, dto: SetCompletionDto) {
    await this.findOne(tenantId, id);
    const existing = await this.db.query.homeworkCompletions.findFirst({
      where: and(eq(homeworkCompletions.homeworkId, id), eq(homeworkCompletions.studentId, dto.studentId)),
    });
    if (existing) {
      await this.db
        .update(homeworkCompletions)
        .set({ completed: dto.completed, updatedAt: new Date() })
        .where(eq(homeworkCompletions.id, existing.id));
    } else {
      await this.db.insert(homeworkCompletions).values({ homeworkId: id, studentId: dto.studentId, completed: dto.completed });
    }
    return { success: true };
  }

  async create(tenantId: string, dto: CreateHomeworkDto) {
    const rows = await Promise.all(
      dto.groupIds.map((groupId) =>
        this.db
          .insert(homework)
          .values({
            tenantId,
            groupId,
            title: dto.title,
            description: dto.description,
            dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          })
          .returning(),
      ),
    );
    return rows.flat();
  }

  async update(tenantId: string, id: string, dto: UpdateHomeworkDto) {
    await this.findOne(tenantId, id);
    const [hw] = await this.db
      .update(homework)
      .set({ ...dto, dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined, updatedAt: new Date() })
      .where(and(eq(homework.id, id), eq(homework.tenantId, tenantId)))
      .returning();
    return hw;
  }

  async attach(tenantId: string, id: string, file: Express.Multer.File) {
    await this.findOne(tenantId, id);
    const [hw] = await this.db
      .update(homework)
      .set({ attachmentPath: file.filename, attachmentName: file.originalname, updatedAt: new Date() })
      .where(and(eq(homework.id, id), eq(homework.tenantId, tenantId)))
      .returning();
    return hw;
  }

  async remove(tenantId: string, id: string) {
    const hw = await this.findOne(tenantId, id);
    if (hw.attachmentPath) {
      await unlink(join(__dirname, '..', '..', 'uploads', hw.attachmentPath)).catch(() => undefined);
    }
    await this.db.delete(homework).where(and(eq(homework.id, id), eq(homework.tenantId, tenantId)));
    return { success: true };
  }
}
