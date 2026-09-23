import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import {
  homework,
  homeworkCompletions,
  enrollments,
  groups,
  students,
  examResults,
} from '../db/schema';
import {
  CreateHomeworkDto,
  UpdateHomeworkDto,
  SetCompletionDto,
  SubmitHomeworkDto,
  GradeHomeworkDto,
} from './dto/homework.dto';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface LeaderboardEntry {
  rank: number;
  studentId: string;
  studentName: string;
  avatarLetter: string;
  totalScore: number;
  homeworkScore: number;
  examScore: number;
  completedHomeworkCount: number;
  badge: string; // 'GOLD' | 'SILVER' | 'BRONZE' | 'TOP_PERFORMER' | 'PARTICIPANT'
}

@Injectable()
export class HomeworkService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
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

  async getRoster(tenantId: string, id: string) {
    const hw = await this.findOne(tenantId, id);
    const enrolled = await this.db.query.enrollments.findMany({
      where: eq(enrollments.groupId, hw.groupId),
      with: { student: true },
    });

    const completionMap = new Map<string, any>();
    for (const c of hw.completions) {
      completionMap.set(c.studentId, c);
    }

    return enrolled.map((e) => {
      const c = completionMap.get(e.studentId);
      return {
        student: e.student,
        completed: Boolean(c?.completed),
        score: c?.score ?? null,
        feedback: c?.feedback ?? null,
        status: c?.status ?? 'PENDING',
        submissionText: c?.submissionText ?? null,
        submissionAttachmentUrl: c?.submissionAttachmentUrl ?? null,
        submittedAt: c?.submittedAt ?? null,
      };
    });
  }

  async setCompletion(tenantId: string, id: string, dto: SetCompletionDto) {
    await this.findOne(tenantId, id);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    const existing = await this.db.query.homeworkCompletions.findFirst({
      where: and(
        eq(homeworkCompletions.homeworkId, id),
        eq(homeworkCompletions.studentId, dto.studentId),
      ),
    });
    if (existing) {
      await this.db
        .update(homeworkCompletions)
        .set({ completed: dto.completed, updatedAt: new Date() })
        .where(eq(homeworkCompletions.id, existing.id));
    } else {
      await this.db.insert(homeworkCompletions).values({
        homeworkId: id,
        studentId: dto.studentId,
        completed: dto.completed,
      });
    }
    return { success: true };
  }

  async submit(tenantId: string, id: string, dto: SubmitHomeworkDto) {
    await this.findOne(tenantId, id);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    const existing = await this.db.query.homeworkCompletions.findFirst({
      where: and(
        eq(homeworkCompletions.homeworkId, id),
        eq(homeworkCompletions.studentId, dto.studentId),
      ),
    });

    if (existing) {
      const [updated] = await this.db
        .update(homeworkCompletions)
        .set({
          completed: true,
          status: 'SUBMITTED',
          submissionText: dto.submissionText || null,
          submissionAttachmentUrl: dto.attachmentUrl || null,
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(homeworkCompletions.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await this.db
      .insert(homeworkCompletions)
      .values({
        homeworkId: id,
        studentId: dto.studentId,
        completed: true,
        status: 'SUBMITTED',
        submissionText: dto.submissionText || null,
        submissionAttachmentUrl: dto.attachmentUrl || null,
        submittedAt: new Date(),
      })
      .returning();
    return created;
  }

  async grade(tenantId: string, id: string, dto: GradeHomeworkDto) {
    const hw = await this.findOne(tenantId, id);
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) throw new NotFoundException("O'quvchi topilmadi");

    const existing = await this.db.query.homeworkCompletions.findFirst({
      where: and(
        eq(homeworkCompletions.homeworkId, id),
        eq(homeworkCompletions.studentId, dto.studentId),
      ),
    });

    let result;
    if (existing) {
      const [updated] = await this.db
        .update(homeworkCompletions)
        .set({
          completed: true,
          score: dto.score,
          feedback: dto.feedback || null,
          status: 'GRADED',
          updatedAt: new Date(),
        })
        .where(eq(homeworkCompletions.id, existing.id))
        .returning();
      result = updated;
    } else {
      const [created] = await this.db
        .insert(homeworkCompletions)
        .values({
          homeworkId: id,
          studentId: dto.studentId,
          completed: true,
          score: dto.score,
          feedback: dto.feedback || null,
          status: 'GRADED',
          submittedAt: new Date(),
        })
        .returning();
      result = created;
    }

    // Trigger Telegram notification to student about their grade
    const max = hw.maxScore || 100;
    const percentage = Math.round((dto.score / max) * 100);
    const msg = `📝 <b>Uy vazifangiz baholandi!</b>\n\n📌 <b>Mavzu:</b> ${hw.title}\n📊 <b>Baho:</b> ${dto.score} / ${max} (${percentage}%)${dto.feedback ? `\n💬 <b>O'qituvchi izohi:</b> ${dto.feedback}` : ''}\n\n<i>TalimCRM tizimi orqali yuborildi.</i>`;
    void this.telegram.notifyStudent(dto.studentId, msg);
    void this.notifications.notifyHomeworkGraded(tenantId, dto.studentId, hw.title, dto.score, dto.feedback);

    return result;
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
            maxScore: dto.maxScore ?? 100,
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
      .set({
        ...dto,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        updatedAt: new Date(),
      })
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

  async getLeaderboard(tenantId: string, groupId?: string): Promise<LeaderboardEntry[]> {
    let studentList: any[] = [];
    if (groupId) {
      const enrolled = await this.db.query.enrollments.findMany({
        where: eq(enrollments.groupId, groupId),
        with: { student: true },
      });
      studentList = enrolled.map((e) => e.student).filter(Boolean);
    } else {
      studentList = await this.db.query.students.findMany({
        where: and(eq(students.tenantId, tenantId), isNull(students.deletedAt)),
      });
    }

    const studentIds = studentList.map((s) => s.id);
    if (studentIds.length === 0) return [];

    // Query homework completions
    const hwCompletions = await this.db.query.homeworkCompletions.findMany({
      where: inArray(homeworkCompletions.studentId, studentIds),
    });

    // Query exam results
    const exResults = await this.db.query.examResults.findMany({
      where: inArray(examResults.studentId, studentIds),
    });

    const hwScoresByStudent = new Map<string, { total: number; count: number }>();
    for (const c of hwCompletions) {
      const existing = hwScoresByStudent.get(c.studentId) || { total: 0, count: 0 };
      if (c.score !== null && c.score !== undefined) {
        existing.total += c.score;
      }
      if (c.completed) {
        existing.count += 1;
      }
      hwScoresByStudent.set(c.studentId, existing);
    }

    const exScoresByStudent = new Map<string, number>();
    for (const r of exResults) {
      const cur = exScoresByStudent.get(r.studentId) || 0;
      exScoresByStudent.set(r.studentId, cur + r.score);
    }

    const entries: Omit<LeaderboardEntry, 'rank' | 'badge'>[] = studentList.map((s) => {
      const hwData = hwScoresByStudent.get(s.id) || { total: 0, count: 0 };
      const exScore = exScoresByStudent.get(s.id) || 0;
      return {
        studentId: s.id,
        studentName: s.fullName,
        avatarLetter: (s.fullName || 'O').charAt(0).toUpperCase(),
        homeworkScore: hwData.total,
        examScore: exScore,
        totalScore: hwData.total + exScore,
        completedHomeworkCount: hwData.count,
      };
    });

    // Sort descending by totalScore
    entries.sort((a, b) => b.totalScore - a.totalScore);

    return entries.map((e, idx) => {
      const rank = idx + 1;
      let badge = 'PARTICIPANT';
      if (rank === 1) badge = 'GOLD';
      else if (rank === 2) badge = 'SILVER';
      else if (rank === 3) badge = 'BRONZE';
      else if (rank <= Math.max(3, Math.ceil(entries.length * 0.2))) badge = 'TOP_PERFORMER';

      return {
        ...e,
        rank,
        badge,
      };
    });
  }
}
