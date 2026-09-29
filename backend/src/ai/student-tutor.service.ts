import { ForbiddenException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, groups, studentAiMessages, students } from '../db/schema';
import { teacherGroupIds } from '../common/teacher-scope';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedDayBounds } from '../common/timezone';
import { AiService } from './ai.service';
import { tutorTopicsPrompt, type TutorTurn } from './tutor-prompt';

// The students' AI tutor, shared by the Telegram bot and the web cabinet:
// one conversation, one daily limit per student (set by the center).

export interface TutorStudent {
  id: string;
  tenantId: string;
  fullName: string;
  tenant?: { name?: string | null; studentAiDailyLimit?: number | null; timezone?: string | null } | null;
}

export type TutorAnswer =
  | { status: 'ok'; reply: string; left: number; limit: number }
  | { status: 'off' | 'unavailable' | 'error' }
  | { status: 'limit'; limit: number };

const KEEP_DAYS = 30;
export const TUTOR_MAX_QUESTION = 1500;

@Injectable()
export class StudentTutorService {
  private readonly logger = new Logger(StudentTutorService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly ai: AiService,
  ) {}

  get available() {
    return this.ai.isConfigured;
  }

  // Questions used today (in the center's time zone) and what is left.
  async quota(student: TutorStudent) {
    const limit = student.tenant?.studentAiDailyLimit ?? 20;
    const tz = isValidTimeZone(student.tenant?.timezone) ? student.tenant!.timezone! : DEFAULT_TIMEZONE;
    const { startOfToday } = zonedDayBounds(new Date(), tz);
    const [row] = await this.db
      .select({ n: count() })
      .from(studentAiMessages)
      .where(and(eq(studentAiMessages.studentId, student.id), eq(studentAiMessages.role, 'user'), gte(studentAiMessages.createdAt, startOfToday)));
    const used = Number(row?.n ?? 0);
    return { limit, used, left: Math.max(0, limit - used) };
  }

  // The current conversation (since the last "new conversation"), oldest first.
  async conversation(studentId: string, max = 40) {
    const rows = await this.db
      .select({ role: studentAiMessages.role, content: studentAiMessages.content, createdAt: studentAiMessages.createdAt })
      .from(studentAiMessages)
      .where(eq(studentAiMessages.studentId, studentId))
      .orderBy(desc(studentAiMessages.createdAt))
      .limit(max + 1);
    const out: Array<{ role: 'user' | 'assistant'; content: string; createdAt: Date }> = [];
    for (const r of rows) {
      if (r.role === 'reset') break;
      if (r.role === 'user' || r.role === 'assistant') out.unshift({ role: r.role, content: r.content, createdAt: r.createdAt });
    }
    return out.slice(-max);
  }

  async ask(student: TutorStudent, text: string): Promise<TutorAnswer> {
    const quota = await this.quota(student);
    if (quota.limit <= 0) return { status: 'off' };
    if (!this.ai.isConfigured) return { status: 'unavailable' };
    if (quota.left <= 0) return { status: 'limit', limit: quota.limit };

    const question = text.trim().slice(0, TUTOR_MAX_QUESTION);
    const history: TutorTurn[] = (await this.conversation(student.id, 10)).map(({ role, content }) => ({ role, content }));
    const enrolls = await this.db.query.enrollments.findMany({
      where: eq(enrollments.studentId, student.id),
      with: { group: true },
    });
    const subjects = [...new Set(enrolls.map((e) => e.group?.subject).filter((x): x is string => Boolean(x)))];

    let reply: string;
    try {
      reply = await this.ai.tutorReply({
        studentName: student.fullName,
        centerName: student.tenant?.name || "O'quv markazi",
        subjects,
        history,
        question,
      });
    } catch (err) {
      this.logger.error(`AI tutor failed for student ${student.id}: ${(err as Error).message}`);
      return { status: 'error' };
    }

    // Explicit times: rows of one insert would otherwise share now() and the
    // question/answer order would be undefined.
    const at = Date.now();
    await this.db.insert(studentAiMessages).values([
      { tenantId: student.tenantId, studentId: student.id, role: 'user', content: question, createdAt: new Date(at) },
      { tenantId: student.tenantId, studentId: student.id, role: 'assistant', content: reply.slice(0, 4000), createdAt: new Date(at + 1) },
    ]);
    await this.db
      .delete(studentAiMessages)
      .where(and(eq(studentAiMessages.studentId, student.id), lt(studentAiMessages.createdAt, new Date(Date.now() - KEEP_DAYS * 86_400_000))));

    return { status: 'ok', reply, left: quota.left - 1, limit: quota.limit };
  }

  async reset(student: Pick<TutorStudent, 'id' | 'tenantId'>) {
    await this.db.insert(studentAiMessages).values({ tenantId: student.tenantId, studentId: student.id, role: 'reset', content: '', createdAt: new Date() });
  }

  // ---- For staff: what a group's students asked the tutor ----

  private async groupForStaff(tenantId: string, groupId: string, role?: string, userId?: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
      columns: { id: true, name: true, subject: true },
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');
    const own = await teacherGroupIds(this.db, tenantId, role, userId);
    if (own && !own.includes(group.id)) throw new ForbiddenException("Bu guruh sizga biriktirilmagan");
    return group;
  }

  private async groupQuestions(tenantId: string, groupId: string, days: number) {
    const members = await this.db
      .select({ id: students.id, fullName: students.fullName })
      .from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .where(and(eq(enrollments.groupId, groupId), eq(enrollments.status, 'ACTIVE'), isNull(students.deletedAt)));
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = members.length
      ? await this.db
          .select({ studentId: studentAiMessages.studentId, content: studentAiMessages.content, createdAt: studentAiMessages.createdAt })
          .from(studentAiMessages)
          .where(and(
            eq(studentAiMessages.tenantId, tenantId),
            inArray(studentAiMessages.studentId, members.map((m) => m.id)),
            eq(studentAiMessages.role, 'user'),
            gte(studentAiMessages.createdAt, since),
          ))
          .orderBy(desc(studentAiMessages.createdAt))
          .limit(400)
      : [];
    return { members, rows };
  }

  async groupReport(tenantId: string, groupId: string, days: number, role?: string, userId?: string) {
    const group = await this.groupForStaff(tenantId, groupId, role, userId);
    const { members, rows } = await this.groupQuestions(tenantId, groupId, days);
    const byStudent = members
      .map((m) => {
        const mine = rows.filter((r) => r.studentId === m.id);
        return {
          studentId: m.id,
          fullName: m.fullName,
          questions: mine.length,
          lastAt: mine[0]?.createdAt ?? null,
          recent: mine.slice(0, 5).map((r) => ({ text: r.content.slice(0, 300), at: r.createdAt })),
        };
      })
      .sort((a, b) => b.questions - a.questions || a.fullName.localeCompare(b.fullName));
    return {
      group,
      days,
      totalQuestions: rows.length,
      activeStudents: byStudent.filter((s) => s.questions > 0).length,
      studentCount: members.length,
      students: byStudent,
    };
  }

  // Topics the group asked about, grouped by the AI (no names are sent).
  async groupTopics(tenantId: string, groupId: string, days: number, role?: string, userId?: string) {
    const group = await this.groupForStaff(tenantId, groupId, role, userId);
    if (!this.ai.isConfigured) throw new ServiceUnavailableException('AI yoqilmagan');
    const { rows } = await this.groupQuestions(tenantId, groupId, days);
    if (rows.length === 0) return { summary: null, questions: 0 };
    const summary = await this.ai.completeText(
      tutorTopicsPrompt({ groupName: group.name, subject: group.subject, days, questions: rows.slice(0, 150).map((r) => r.content) }),
      900,
    );
    return { summary: summary.trim(), questions: rows.length };
  }
}
