import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { homework, homeworkCompletions, enrollments, groups, students } from '../db/schema';
import { CreateHomeworkDto, UpdateHomeworkDto, SetCompletionDto } from './dto/homework.dto';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class HomeworkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
  ) {}

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
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException('O\'quvchi topilmadi');
    }

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
    const flat = rows.flat();

    // Trigger Telegram notification to students in assigned groups
    for (const hw of flat) {
      const group = await this.db.query.groups.findFirst({ where: eq(groups.id, hw.groupId) });
      const dueStr = hw.dueDate ? new Date(hw.dueDate).toLocaleDateString('uz-UZ') : 'Muddatsiz';
      const notificationText = `📚 <b>Yangi uy vazifasi!</b>\n\n📌 <b>Guruh:</b> ${group?.name || 'Guruh'}\n📝 <b>Vazifa:</b> ${hw.title}\n⏰ <b>Topshirish muddati:</b> ${dueStr}${hw.description ? `\n\n📖 ${hw.description}` : ''}`;
      void this.telegram.notifyGroup(tenantId, hw.groupId, notificationText);
    }

    return flat;
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
