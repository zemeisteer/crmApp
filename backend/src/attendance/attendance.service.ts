import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, enrollments, groups, lessonTopics, makeupCredits, payments, students, teachers } from '../db/schema';
import { centerToday } from '../common/center-today';
import { lessonsOfGroupOn, type LessonOccurrence } from '../lessons/occurrences';
import { DEFAULT_TIMEZONE, zonedParts } from '../common/timezone';
import { tenants } from '../db/schema';
import { MarkAttendanceDto, QrCheckInDto, QueryAttendanceDto } from './dto/attendance.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { teacherGroupIds } from '../common/teacher-scope';
import { settleAbsenceCredits } from '../makeups/eligibility';
import { lessonInstant, staysByMember, staysOf, wasMember } from '../enrollments/membership';

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * The lesson a mark is for. Attendance is kept per lesson - the timetable
   * row and the date (lessons/occurrences.ts):
   *  - `scheduleId` names the lesson; it must be a lesson of this group on
   *    this date;
   *  - without it, the group's only timetable lesson that day is meant;
   *    several lessons that day have to be told apart (LESSON_AMBIGUOUS);
   *  - a group with no timetable lesson that day (or no timetable rows at
   *    all) gets a mark for the day as a whole, as before;
   *  - a lesson that was called off takes no new marks (the marks it
   *    already has stay as history).
   */
  private async lessonFor(tenantId: string, groupId: string, date: string, scheduleId?: string): Promise<LessonOccurrence | null> {
    const lessons = await lessonsOfGroupOn(this.db, tenantId, groupId, date, true);
    let lesson: LessonOccurrence | null;
    if (scheduleId) {
      lesson = lessons.find((l) => l.scheduleId === scheduleId) ?? null;
      if (!lesson) throw new BadRequestException({ code: 'NO_LESSON', message: "Bu kuni guruhning bunday darsi yo'q" });
    } else {
      const withRow = lessons.filter((l) => l.scheduleId);
      if (withRow.length > 1) {
        throw new BadRequestException({
          code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bor: qaysi biri ekanini tanlang',
          lessons: withRow.map((l) => ({ scheduleId: l.scheduleId, startTime: l.startTime, endTime: l.endTime, cancelled: l.cancelled })),
        });
      }
      lesson = withRow[0] ?? null;
    }
    const off = lesson ? lesson.cancelled : lessons.length > 0 && lessons.every((l) => l.cancelled);
    if (off) throw new ConflictException({ code: 'LESSON_CANCELLED', message: 'Bu dars bekor qilingan: unga davomat yozilmaydi' });
    return lesson;
  }

  async mark(tenantId: string, dto: MarkAttendanceDto, role?: string, userId?: string) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
    });
    if (!group) {
      throw new NotFoundException('Guruh topilmadi');
    }
    const lesson = await this.lessonFor(tenantId, dto.groupId, dto.date, dto.scheduleId);

    if (role === 'TEACHER' && userId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.userId, userId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      // Their own group's lessons, or a single lesson given to them (a substitute).
      const theirs = !!teacher && (group.teacherId === teacher.id || (!!lesson && lesson.teacherId === teacher.id));
      if (!theirs) {
        throw new ForbiddenException("Siz faqat o'zingizga biriktirilgan guruhlar uchun davomat kiritishingiz mumkin");
      }
    }

    const studentIds = dto.entries.map((e) => e.studentId);
    // The lesson has to be the student's (enrollments/membership.ts): in the
    // group then, or - for a student the center entered late - before their
    // first known stay. Not during a break between two stays, and not after
    // they left; someone who has left since can still be marked for the
    // lessons they had.
    const [center] = await this.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const tz = center?.tz || DEFAULT_TIMEZONE;
    const known = await this.db.select({ id: students.id }).from(students)
      .where(and(inArray(students.id, studentIds), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
    const stays = staysByMember(await staysOf(this.db, tenantId, { studentIds, groupIds: [dto.groupId] }));
    const when = { date: dto.date, at: lessonInstant(dto.date, lesson?.startTime, tz) };
    const validStudentIds = new Set(known.map((s) => s.id).filter((id) => wasMember(stays.get(`${id}|${dto.groupId}`) ?? [], when, tz, 'lenient')));

    for (const entry of dto.entries) {
      if (!validStudentIds.has(entry.studentId)) {
        throw new BadRequestException({ code: 'NOT_A_MEMBER', message: `O'quvchi ${entry.studentId} bu darsda ushbu guruh a'zosi bo'lmagan` });
      }
    }

    // All the marks or none: one transaction. A repeated or simultaneous
    // save ends in the same single row per student and lesson (the unique
    // indexes, with an upsert). A mark that is no longer ABSENT settles the
    // make-up credit issued for that absence (makeups/eligibility.ts): an
    // unused credit is voided, a booked one refuses the correction.
    const scheduleId = lesson?.scheduleId ?? null;
    const rows = await this.db.transaction(async (tx) => {
      const saved = [];
      for (const entry of dto.entries) {
        const values = { tenantId, groupId: dto.groupId, studentId: entry.studentId, date: dto.date, status: entry.status as any };
        if (!scheduleId) {
          saved.push(await tx.insert(attendance).values(values)
            .onConflictDoUpdate({ target: [attendance.studentId, attendance.groupId, attendance.date], targetWhere: sql`schedule_id IS NULL`, set: { status: entry.status as any, updatedAt: new Date() } })
            .returning());
          continue;
        }
        const lessonValues = { ...values, scheduleId, startTime: lesson!.startTime };
        const [has] = await tx.select({ id: attendance.id }).from(attendance)
          .where(and(eq(attendance.studentId, entry.studentId), eq(attendance.scheduleId, scheduleId), eq(attendance.date, dto.date)));
        if (!has) {
          // An old mark for the day as a whole, now said to be this lesson's:
          // the same row (its id stays), and the credit issued for it with it.
          const adopted = await tx.update(attendance).set({ scheduleId, startTime: lesson!.startTime, status: entry.status as any, updatedAt: new Date() })
            .where(and(eq(attendance.tenantId, tenantId), eq(attendance.studentId, entry.studentId), eq(attendance.groupId, dto.groupId), eq(attendance.date, dto.date), isNull(attendance.scheduleId)))
            .returning();
          if (adopted.length) {
            const [taken] = await tx.select({ id: makeupCredits.id }).from(makeupCredits)
              .where(and(eq(makeupCredits.studentId, entry.studentId), eq(makeupCredits.originScheduleId, scheduleId), eq(makeupCredits.originDate, dto.date), ne(makeupCredits.status, 'CANCELLED')));
            if (!taken) {
              await tx.update(makeupCredits).set({ originScheduleId: scheduleId, updatedAt: new Date() })
                .where(and(eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.studentId, entry.studentId), eq(makeupCredits.originGroupId, dto.groupId), eq(makeupCredits.originDate, dto.date), eq(makeupCredits.reason, 'ABSENT'), isNull(makeupCredits.originScheduleId)));
            }
            saved.push(adopted);
            continue;
          }
        }
        saved.push(await tx.insert(attendance).values(lessonValues)
          .onConflictDoUpdate({ target: [attendance.studentId, attendance.scheduleId, attendance.date], targetWhere: sql`schedule_id IS NOT NULL`, set: { status: entry.status as any, startTime: lesson!.startTime, updatedAt: new Date() } })
          .returning());
      }
      await settleAbsenceCredits(tx, tenantId, dto.groupId, dto.date, dto.entries.filter((e) => e.status !== 'ABSENT').map((e) => e.studentId), userId ?? null, scheduleId);
      return saved;
    });

    const absentOrLate = dto.entries.filter((e) => e.status === 'ABSENT' || e.status === 'LATE');
    if (absentOrLate.length > 0) {
      const groupName = group?.name ?? 'guruh';
      for (const entry of absentOrLate) {
        void this.notifications.notifyAttendance(
          tenantId,
          entry.studentId,
          entry.status,
          dto.date,
          groupName,
        );
      }
    }

    if (dto.topic !== undefined) await this.saveTopic(tenantId, dto.groupId, dto.date, dto.topic);

    const flat = rows.flat();
    void this.webhooks.dispatch(tenantId, 'attendance.marked', { groupId: dto.groupId, date: dto.date, scheduleId, entries: flat });
    return flat;
  }

  private async saveTopic(tenantId: string, groupId: string, date: string, raw: string) {
    const topic = raw.trim();
    if (!topic) {
      await this.db.delete(lessonTopics).where(and(eq(lessonTopics.tenantId, tenantId), eq(lessonTopics.groupId, groupId), eq(lessonTopics.date, date)));
      return;
    }
    await this.db
      .insert(lessonTopics)
      .values({ tenantId, groupId, date, topic })
      .onConflictDoUpdate({ target: [lessonTopics.groupId, lessonTopics.date], set: { topic, updatedAt: new Date() } });
  }

  // Lesson topics of one group, newest first (teachers: own groups only).
  async topics(tenantId: string, groupId: string, viewer?: { role?: string; userId?: string }) {
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope && !scope.includes(groupId)) return [];
    return this.db
      .select({ date: lessonTopics.date, topic: lessonTopics.topic })
      .from(lessonTopics)
      .where(and(eq(lessonTopics.tenantId, tenantId), eq(lessonTopics.groupId, groupId)))
      .orderBy(desc(lessonTopics.date));
  }

  async findAll(tenantId: string, query: QueryAttendanceDto, viewer?: { role?: string; userId?: string }) {
    const conditions = [eq(attendance.tenantId, tenantId)];
    // Teachers see attendance of their own groups only.
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope) {
      if (scope.length === 0) return [];
      conditions.push(inArray(attendance.groupId, scope));
    }
    if (query.groupId) conditions.push(eq(attendance.groupId, query.groupId));
    if (query.date) conditions.push(eq(attendance.date, query.date));
    if (query.studentId) conditions.push(eq(attendance.studentId, query.studentId));
    // One lesson of the day ("none": the day-level marks).
    if (query.scheduleId) conditions.push(query.scheduleId === 'none' ? isNull(attendance.scheduleId) : eq(attendance.scheduleId, query.scheduleId));
    if (query.from) conditions.push(gte(attendance.date, query.from));
    if (query.to) conditions.push(lte(attendance.date, query.to));

    if (!query.page) {
      return this.db.query.attendance.findMany({
        where: and(...conditions),
        orderBy: (a, { desc }) => desc(a.date),
      });
    }
    const pageSize = Math.min(query.pageSize ?? 100, 500);
    const [{ total }] = await this.db.select({ total: count() }).from(attendance).where(and(...conditions));
    const items = await this.db.query.attendance.findMany({
      where: and(...conditions),
      orderBy: (a, { desc }) => [desc(a.date), desc(a.id)],
      limit: pageSize,
      offset: (query.page - 1) * pageSize,
    });
    return { items, total: Number(total), page: query.page, pageSize };
  }

  /**
   * Marks that were not bound to a lesson although their group has
   * timetable lessons: old marks the migration could not match to exactly
   * one lesson (none that weekday, or several), and marks made on a day
   * with no timetable lesson. For the people who run the center, so that
   * nothing ambiguous is hidden; nothing here is changed or guessed.
   */
  async unbound(tenantId: string) {
    const res = await this.db.execute(sql`
      SELECT a.group_id AS "groupId", g.name AS "groupName", a.date, count(*)::int AS marks,
        (SELECT count(*)::int FROM schedules s WHERE s.group_id = a.group_id AND s.status <> 'CANCELLED'
           AND ((s.date IS NULL AND s.day_of_week = extract(isodow FROM (CASE WHEN a.date ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN a.date END)::date)::int) OR s.date = a.date)) AS lessons
      FROM attendance a JOIN groups g ON g.id = a.group_id
      WHERE a.tenant_id = ${tenantId} AND a.schedule_id IS NULL
        AND EXISTS (SELECT 1 FROM schedules s WHERE s.group_id = a.group_id)
      GROUP BY a.group_id, g.name, a.date
      ORDER BY a.date DESC, g.name
      LIMIT 500`);
    const rows = (res as unknown as { rows: Array<{ groupId: string; groupName: string; date: string; marks: number; lessons: number }> }).rows;
    return {
      total: rows.reduce((n, r) => n + r.marks, 0),
      // SEVERAL: more than one lesson that day, not clear which was meant. NONE: no timetable lesson that day.
      days: rows.map((r) => ({ ...r, reason: r.lessons > 1 ? 'SEVERAL' as const : 'NONE' as const })),
    };
  }

  /** The lesson a scan is for: the one going on or about to start; a day-level mark when the group has none. */
  private async lessonNow(tenantId: string, groupId: string, date: string): Promise<LessonOccurrence | null> {
    const lessons = (await lessonsOfGroupOn(this.db, tenantId, groupId, date)).filter((l) => l.scheduleId);
    if (lessons.length <= 1) return lessons[0] ?? null;
    const [t] = await this.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const p = zonedParts(new Date(), t?.tz || DEFAULT_TIMEZONE);
    const now = p.hour * 60 + p.minute;
    const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    // Going on now (from half an hour before it starts), else the nearest by its start.
    const running = lessons.find((l) => now >= minutes(l.startTime) - 30 && now <= minutes(l.endTime));
    return running ?? [...lessons].sort((a, b) => Math.abs(minutes(a.startTime) - now) - Math.abs(minutes(b.startTime) - now))[0];
  }

  async qrCheckIn(tenantId: string, dto: QrCheckInDto, viewer?: { role?: string; userId?: string }) {
    let studentId = (dto.code || '').trim();
    if (studentId.startsWith('CRMAPP:STUDENT:')) {
      studentId = studentId.replace('CRMAPP:STUDENT:', '');
    } else if (studentId.startsWith('TALIMCRM:STUDENT:')) {
      studentId = studentId.replace('TALIMCRM:STUDENT:', '');
    } else if (studentId.startsWith('STUDENT_')) {
      studentId = studentId.replace('STUDENT_', '');
    }

    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId), isNull(students.deletedAt)),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    const activeEnrollments = await this.db.query.enrollments.findMany({
      where: and(eq(enrollments.studentId, student.id), eq(enrollments.status, 'ACTIVE')),
      with: {
        group: true,
      },
    });

    if (activeEnrollments.length === 0) {
      throw new BadRequestException("O'quvchi hech qanday faol guruhga biriktirilmagan");
    }

    // A teacher can only check a student into one of the teacher's groups.
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    const allowed = scope ? activeEnrollments.filter((e) => scope.includes(e.groupId)) : activeEnrollments;
    if (allowed.length === 0) {
      throw new ForbiddenException("Bu o'quvchi sizning guruhlaringizda emas");
    }

    let targetGroup = allowed[0].group;
    if (dto.groupId) {
      const matched = allowed.find((e) => e.groupId === dto.groupId);
      if (matched) {
        targetGroup = matched.group;
      }
    }

    // The center's own day (a scan late in the evening is still today there).
    const targetDate = dto.date || await centerToday(this.db, tenantId);
    const lesson = await this.lessonNow(tenantId, targetGroup.id, targetDate);
    const existing = await this.db.query.attendance.findFirst({
      where: and(
        eq(attendance.tenantId, tenantId),
        eq(attendance.studentId, student.id),
        eq(attendance.groupId, targetGroup.id),
        eq(attendance.date, targetDate),
        // This lesson's mark (or the day's, for a group with no timetable lesson today).
        lesson?.scheduleId ? eq(attendance.scheduleId, lesson.scheduleId) : isNull(attendance.scheduleId),
      ),
    });

    let status = 'PRESENT';
    let alreadyMarked = false;

    if (existing) {
      alreadyMarked = true;
      status = existing.status;
    } else {
      await this.db
        .insert(attendance)
        .values({
          tenantId,
          groupId: targetGroup.id,
          studentId: student.id,
          date: targetDate,
          status: status as any,
          scheduleId: lesson?.scheduleId ?? null,
          startTime: lesson?.scheduleId ? lesson.startTime : null,
        })
        // Two scans at once: the second finds the first's row and changes nothing.
        .onConflictDoNothing();

      void this.webhooks.dispatch(tenantId, 'attendance.marked', {
        groupId: targetGroup.id,
        date: targetDate,
        studentId: student.id,
        status,
        via: 'QR_SCANNER',
      });

      const arrivalTime = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
      const notificationText = `✅ <b>Davomat qayd etildi</b>\n\n👤 <b>O'quvchi:</b> ${student.fullName}\n👥 <b>Guruh:</b> ${targetGroup.name}\n⏰ <b>Kelgan vaqti:</b> ${arrivalTime}\n📅 <b>Sana:</b> ${targetDate}\n\n<i>O'quv markaziga muvaffaqiyatli yetib keldi.</i>`;

      if (student.telegramChatId) {
        void this.telegram.sendMessage(student.telegramChatId, notificationText);
      }
    }

    const studentPayments = await this.db.query.payments.findMany({
      where: and(
        eq(payments.tenantId, tenantId),
        eq(payments.studentId, student.id),
        eq(payments.status, 'PAID'),
      ),
    });
    const totalPaid = studentPayments.reduce((acc, p) => acc + p.amount, 0);
    const monthlyFee = targetGroup.monthlyPrice || 0;
    const hasDebt = monthlyFee > 0 && totalPaid === 0;

    return {
      success: true,
      alreadyMarked,
      student: {
        id: student.id,
        fullName: student.fullName,
        phone: student.phone,
        parentPhone: student.parentPhone,
        telegramLinked: Boolean(student.telegramChatId),
      },
      group: {
        id: targetGroup.id,
        name: targetGroup.name,
        monthlyPrice: targetGroup.monthlyPrice,
      },
      attendance: {
        date: targetDate,
        status,
        time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
      },
      finance: {
        monthlyPrice: monthlyFee,
        totalPaid,
        hasDebt,
      },
    };
  }
}

