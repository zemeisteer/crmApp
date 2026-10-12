import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { and, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, enrollments, groups, lessonTopics, makeupCredits, schedules, students, teachers, tenants } from '../db/schema';
import { centerToday } from '../common/center-today';
import { lockStudents } from '../common/student-lock';
import { lockTimetable } from '../common/timetable-lock';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { isoWeekdaysOf } from '../common/weekdays';
import { isDate, lessonsOfGroupOn, type LessonOccurrence } from '../lessons/occurrences';
import { MarkAttendanceDto, QrCheckInDto, QueryAttendanceDto } from './dto/attendance.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';
import { teacherGroupIds } from '../common/teacher-scope';
import { settleAbsenceCredits } from '../makeups/eligibility';
import { lessonInstant, memberAt, staysByMember, staysOf, wasMember } from '../enrollments/membership';
import { LedgerService } from '../ledger/ledger.service';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Exec = Database | Tx;
type GroupRow = typeof groups.$inferSelect;
export interface AttendanceViewer { role?: string; userId?: string }

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
// A scan counts for a lesson from half an hour before it starts until it ends.
const EARLY_MIN = 30;

/**
 * Attendance, however it is taken - the list on the group page, a QR scan,
 * the Telegram bot (TelegramService calls `mark`) - goes through the same
 * four checks, made INSIDE the transaction that writes, after its locks:
 *
 *  1. the lesson: its timetable row and the date (`lessonFor`). A lesson
 *     that was called off takes no marks; a group with no timetable lesson
 *     that day is a different case from a lesson called off;
 *  2. the center: the group, the students and the lesson are all the
 *     caller's center's;
 *  3. who is asking: a teacher marks their own group's lessons, or a lesson
 *     given to them;
 *  4. whose lesson it was: the membership history (enrollments/membership.ts).
 *
 * Locks, in this order: the center's timetable (a lesson being called off
 * waits for the save or is seen by it), then the students (a status or
 * membership change waits or is seen). One row per student and lesson, by
 * the unique indexes; all the marks of one save or none.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
    @Optional() private readonly ledger?: LedgerService,
  ) {}

  private async zone(db: Exec, tenantId: string) {
    const [center] = await db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return isValidTimeZone(center?.tz) ? center.tz : DEFAULT_TIMEZONE;
  }

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
  private async lessonFor(db: Exec, tenantId: string, groupId: string, date: string, scheduleId?: string): Promise<LessonOccurrence | null> {
    const lessons = await lessonsOfGroupOn(db, tenantId, groupId, date, true);
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

  /** A teacher marks the lessons of their own group, or a single lesson given to them (a substitute). */
  private async teacherMay(db: Exec, tenantId: string, group: Pick<GroupRow, 'teacherId'>, lesson: LessonOccurrence | null, viewer?: AttendanceViewer) {
    if (viewer?.role !== 'TEACHER') return true;
    if (!viewer.userId) return false;
    const [teacher] = await db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.userId, viewer.userId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
    return !!teacher && (group.teacherId === teacher.id || (!!lesson && lesson.teacherId === teacher.id));
  }

  async mark(tenantId: string, dto: MarkAttendanceDto, role?: string, userId?: string) {
    if (!isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const studentIds = [...new Set(dto.entries.map((e) => e.studentId))];

    const { rows, scheduleId, group } = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      await lockStudents(tx, tenantId, studentIds);

      const [group] = await tx.select().from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (!group) throw new NotFoundException('Guruh topilmadi');
      const lesson = await this.lessonFor(tx, tenantId, dto.groupId, dto.date, dto.scheduleId);
      if (!(await this.teacherMay(tx, tenantId, group, lesson, { role, userId }))) {
        throw new ForbiddenException("Siz faqat o'zingizga biriktirilgan guruhlar uchun davomat kiritishingiz mumkin");
      }

      // The lesson has to be the student's (enrollments/membership.ts): in
      // the group then, or - for a student the center entered late - before
      // their first known stay. Not during a break between two stays, and
      // not after they left; someone who has left since can still be marked
      // for the lessons they had.
      const tz = await this.zone(tx, tenantId);
      const known = await tx.select({ id: students.id }).from(students)
        .where(and(inArray(students.id, studentIds), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
      const stays = staysByMember(await staysOf(tx, tenantId, { studentIds, groupIds: [dto.groupId] }));
      const when = { date: dto.date, at: lessonInstant(dto.date, lesson?.startTime, tz) };
      const valid = new Set(known.map((s) => s.id).filter((id) => wasMember(stays.get(`${id}|${dto.groupId}`) ?? [], when, tz, 'lenient')));
      for (const entry of dto.entries) {
        if (!valid.has(entry.studentId)) {
          throw new BadRequestException({ code: 'NOT_A_MEMBER', message: `O'quvchi ${entry.studentId} bu darsda ushbu guruh a'zosi bo'lmagan` });
        }
      }

      // All the marks or none. A repeated or simultaneous save ends in the
      // same single row per student and lesson (the unique indexes, with an
      // upsert). A mark that is no longer ABSENT settles the make-up credit
      // issued for that absence (makeups/eligibility.ts): an unused credit
      // is voided, a booked one refuses the correction.
      const scheduleId = lesson?.scheduleId ?? null;
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
      // The topic is the lesson's, saved with its marks or not at all.
      if (dto.topic !== undefined) await this.saveTopic(tx, tenantId, dto.groupId, dto.date, scheduleId, dto.topic);
      return { rows: saved, scheduleId, group };
    });

    const absentOrLate = dto.entries.filter((e) => e.status === 'ABSENT' || e.status === 'LATE');
    for (const entry of absentOrLate) {
      void this.notifications.notifyAttendance(tenantId, entry.studentId, entry.status, dto.date, group.name ?? 'guruh');
    }

    const flat = rows.flat();
    void this.webhooks.dispatch(tenantId, 'attendance.marked', { groupId: dto.groupId, date: dto.date, scheduleId, entries: flat });
    return flat;
  }

  /** The topic of one lesson (`scheduleId`), or of the group's day when the day has no timetable lesson. */
  private async saveTopic(db: Exec, tenantId: string, groupId: string, date: string, scheduleId: string | null, raw: string) {
    const topic = raw.trim();
    const mine = and(
      eq(lessonTopics.tenantId, tenantId), eq(lessonTopics.groupId, groupId), eq(lessonTopics.date, date),
      scheduleId ? eq(lessonTopics.scheduleId, scheduleId) : isNull(lessonTopics.scheduleId),
    );
    if (!topic) {
      await db.delete(lessonTopics).where(mine);
      return;
    }
    if (scheduleId) {
      await db.insert(lessonTopics).values({ tenantId, groupId, date, scheduleId, topic })
        .onConflictDoUpdate({ target: [lessonTopics.scheduleId, lessonTopics.date], targetWhere: sql`schedule_id IS NOT NULL`, set: { topic, updatedAt: new Date() } });
    } else {
      await db.insert(lessonTopics).values({ tenantId, groupId, date, topic })
        .onConflictDoUpdate({ target: [lessonTopics.groupId, lessonTopics.date], targetWhere: sql`schedule_id IS NULL`, set: { topic, updatedAt: new Date() } });
    }
  }

  // Lesson topics of one group, newest first (teachers: own groups only).
  // `scheduleId`: the lesson the topic is of; null: the day as a whole.
  async topics(tenantId: string, groupId: string, viewer?: AttendanceViewer) {
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope && !scope.includes(groupId)) return [];
    return this.db
      .select({ date: lessonTopics.date, topic: lessonTopics.topic, scheduleId: lessonTopics.scheduleId })
      .from(lessonTopics)
      .where(and(eq(lessonTopics.tenantId, tenantId), eq(lessonTopics.groupId, groupId)))
      .orderBy(desc(lessonTopics.date));
  }

  async findAll(tenantId: string, query: QueryAttendanceDto, viewer?: AttendanceViewer) {
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
    // One lesson's marks ("none": the day-level ones).
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

  // ---- QR -----------------------------------------------------------------

  /**
   * What a scan can be for in one group on a date. Never a guess:
   *  - LESSON: exactly one lesson is meant - the one named, the only one of
   *    the day, or (today) the only one going on now;
   *  - DAY: the group has no timetable at all, so its attendance is kept
   *    per day;
   *  - NO_LESSON: the group has a timetable and no lesson that day;
   *  - CANCELLED: its lesson(s) that day were called off;
   *  - AMBIGUOUS: several lessons and nothing says which.
   */
  private async scanTarget(tx: Tx, tenantId: string, group: GroupRow, date: string, nowMinutes: number | null, scheduleId?: string):
    Promise<{ kind: 'LESSON'; lesson: LessonOccurrence; running: boolean } | { kind: 'DAY' | 'NO_LESSON' | 'CANCELLED' } | { kind: 'AMBIGUOUS'; lessons: LessonOccurrence[] }> {
    const all = await lessonsOfGroupOn(tx, tenantId, group.id, date, true);
    const live = all.filter((l) => !l.cancelled);
    const isRunning = (l: LessonOccurrence) => nowMinutes !== null && nowMinutes >= minutes(l.startTime) - EARLY_MIN && nowMinutes <= minutes(l.endTime);
    if (scheduleId) {
      const named = all.find((l) => l.scheduleId === scheduleId);
      if (!named) return { kind: 'NO_LESSON' };
      return named.cancelled ? { kind: 'CANCELLED' } : { kind: 'LESSON', lesson: named, running: isRunning(named) };
    }
    if (live.length === 0) {
      if (all.length > 0) return { kind: 'CANCELLED' };
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schedules).where(and(eq(schedules.groupId, group.id), eq(schedules.tenantId, tenantId)));
      const hasTimetable = group.timetableManaged || n > 0 || (isoWeekdaysOf(group.scheduleDays).length > 0 && !!group.startTime);
      return { kind: hasTimetable ? 'NO_LESSON' : 'DAY' };
    }
    if (live.length === 1) return { kind: 'LESSON', lesson: live[0], running: isRunning(live[0]) };
    const running = live.filter(isRunning);
    return running.length === 1 ? { kind: 'LESSON', lesson: running[0], running: true } : { kind: 'AMBIGUOUS', lessons: live };
  }

  /**
   * A scanned student card: PRESENT in the lesson that is meant - checked
   * like any other mark (the lesson, the center, who is asking, whose
   * lesson it is), in one transaction under the same locks.
   *
   *  - A student who is paused, has left, graduated or was removed is not
   *    marked.
   *  - `groupId` that is not one of the student's groups is an error, never
   *    silently another group. Without it the student's one group is used;
   *    with several, the one whose lesson is on now, else the caller has to
   *    say (GROUP_AMBIGUOUS).
   *  - A lesson called off is refused (LESSON_CANCELLED) - it is not turned
   *    into a mark for the day. A day with no lesson is refused
   *    (NO_LESSON_TODAY). Only a group with no timetable at all gets a
   *    day-level mark.
   *  - Two lessons that day and none going on: LESSON_AMBIGUOUS.
   *  - Two scans at once: one row, one "arrived" event. The second scan is
   *    told the student is already marked and sends nothing.
   */
  async qrCheckIn(tenantId: string, dto: QrCheckInDto, viewer?: AttendanceViewer) {
    let studentId = (dto.code || '').trim();
    for (const prefix of ['CRMAPP:STUDENT:', 'TALIMCRM:STUDENT:', 'STUDENT_']) {
      if (studentId.startsWith(prefix)) {
        studentId = studentId.slice(prefix.length);
        break;
      }
    }
    if (!studentId) throw new NotFoundException("O'quvchi topilmadi");
    if (dto.date && !isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");

    const result = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      await lockStudents(tx, tenantId, [studentId]);

      const [student] = await tx.select().from(students).where(and(eq(students.id, studentId), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
      if (!student) throw new NotFoundException("O'quvchi topilmadi");
      if (student.status !== 'ACTIVE') {
        throw new ConflictException({ code: 'STUDENT_NOT_ATTENDING', status: student.status, message: "O'quvchi hozir o'qimayapti (pauza, ketgan yoki bitirgan): davomat yozilmadi" });
      }

      const tz = await this.zone(tx, tenantId);
      const today = await centerToday(tx, tenantId);
      const date = dto.date || today;
      const p = zonedParts(new Date(), tz);
      const nowMinutes = date === today ? p.hour * 60 + p.minute : null;

      const mine = await tx.select({ group: groups }).from(enrollments).innerJoin(groups, eq(groups.id, enrollments.groupId))
        .where(and(eq(enrollments.studentId, student.id), eq(enrollments.status, 'ACTIVE'), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
      if (mine.length === 0) throw new BadRequestException({ code: 'NOT_ENROLLED', message: "O'quvchi hech qanday faol guruhga biriktirilmagan" });
      let candidates = mine.map((m) => m.group);
      if (dto.groupId) {
        candidates = candidates.filter((g) => g.id === dto.groupId);
        // Named and not theirs: an error, not "then some other group of theirs".
        if (candidates.length === 0) throw new BadRequestException({ code: 'NOT_IN_GROUP', message: "O'quvchi bu guruhda o'qimaydi" });
      }

      const targets = [];
      for (const group of candidates) {
        const target = await this.scanTarget(tx, tenantId, group, date, nowMinutes, candidates.length === 1 ? dto.scheduleId : undefined);
        const lesson = target.kind === 'LESSON' ? target.lesson : null;
        if (!(await this.teacherMay(tx, tenantId, group, lesson, viewer))) continue;
        targets.push({ group, target });
      }
      if (targets.length === 0) throw new ForbiddenException("Bu o'quvchi sizning guruhlaringizda emas");

      const usable = targets.filter((t) => t.target.kind === 'LESSON' || t.target.kind === 'DAY');
      const running = usable.filter((t) => t.target.kind === 'LESSON' && t.target.running);
      const chosen = running.length === 1 ? running[0] : usable.length === 1 ? usable[0] : null;
      if (!chosen) {
        if (usable.length > 1) {
          throw new BadRequestException({
            code: 'GROUP_AMBIGUOUS', message: "O'quvchi bir nechta guruhda: qaysi guruh ekanini tanlang",
            groups: usable.map((t) => ({ groupId: t.group.id, name: t.group.name, startTime: t.target.kind === 'LESSON' ? t.target.lesson.startTime : null })),
          });
        }
        const several = targets.find((t) => t.target.kind === 'AMBIGUOUS');
        if (several && several.target.kind === 'AMBIGUOUS') {
          throw new BadRequestException({
            code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bor: qaysi biri ekanini tanlang', groupId: several.group.id,
            lessons: several.target.lessons.map((l) => ({ scheduleId: l.scheduleId, startTime: l.startTime, endTime: l.endTime })),
          });
        }
        if (targets.some((t) => t.target.kind === 'CANCELLED')) throw new ConflictException({ code: 'LESSON_CANCELLED', message: 'Bu dars bekor qilingan: unga davomat yozilmaydi' });
        throw new ConflictException({ code: 'NO_LESSON_TODAY', message: "Bu kuni guruhning darsi yo'q" });
      }
      const group = chosen.group;
      const lesson = chosen.target.kind === 'LESSON' ? chosen.target.lesson : null;

      // Whose lesson: today, in the group right now; for another date, as for any mark.
      const stays = await staysOf(tx, tenantId, { studentIds: [student.id], groupIds: [group.id] });
      const member = nowMinutes !== null
        ? memberAt(stays, new Date())
        : wasMember(stays, { date, at: lessonInstant(date, lesson?.startTime, tz) }, tz, 'lenient');
      if (!member) throw new BadRequestException({ code: 'NOT_A_MEMBER', message: "O'quvchi bu darsda ushbu guruh a'zosi emas" });

      const scheduleId = lesson?.scheduleId ?? null;
      const mineMark = and(
        eq(attendance.tenantId, tenantId), eq(attendance.studentId, student.id), eq(attendance.groupId, group.id), eq(attendance.date, date),
        scheduleId ? eq(attendance.scheduleId, scheduleId) : isNull(attendance.scheduleId),
      );
      // The row decides who was first: an insert that changed nothing means someone else's scan already made it.
      const made = await tx.insert(attendance)
        .values({ tenantId, groupId: group.id, studentId: student.id, date, status: 'PRESENT', scheduleId, startTime: scheduleId ? lesson!.startTime : null })
        .onConflictDoNothing().returning();
      const [row] = made.length ? made : await tx.select().from(attendance).where(mineMark);
      return { student, group, lesson, date, row, created: made.length === 1 };
    });

    const { student, group, lesson, date, row, created } = result;
    const time = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
    if (created) {
      // Once per mark: only the scan that made the row announces it.
      void this.webhooks.dispatch(tenantId, 'attendance.marked', { groupId: group.id, date, scheduleId: row.scheduleId, studentId: student.id, status: row.status, via: 'QR_SCANNER' });
      if (student.telegramChatId) {
        const text = `✅ <b>Davomat qayd etildi</b>\n\n👤 <b>O'quvchi:</b> ${student.fullName}\n👥 <b>Guruh:</b> ${group.name}\n⏰ <b>Kelgan vaqti:</b> ${time}\n📅 <b>Sana:</b> ${date}\n\n<i>O'quv markaziga muvaffaqiyatli yetib keldi.</i>`;
        void this.telegram.sendMessage(student.telegramChatId, text);
      }
    }

    return {
      success: true,
      alreadyMarked: !created,
      student: { id: student.id, fullName: student.fullName, phone: student.phone, parentPhone: student.parentPhone, telegramLinked: Boolean(student.telegramChatId) },
      group: { id: group.id, name: group.name, monthlyPrice: group.monthlyPrice },
      attendance: { date, status: row.status, time, scheduleId: row.scheduleId, startTime: lesson?.startTime ?? null },
      finance: await this.debtOf(tenantId, student.id, group.monthlyPrice || 0),
    };
  }

  /**
   * What the student owes for the current month - the figure the payments
   * page and the cabinet show (LedgerService), not "has ever paid anything":
   * a payment last spring says nothing about this month.
   */
  private async debtOf(tenantId: string, studentId: string, monthlyPrice: number) {
    if (!this.ledger) return { monthlyPrice, forMonth: null, expected: null, paid: null, debt: null, hasDebt: null };
    const forMonth = await this.ledger.currentMonth(tenantId);
    const loaded = await this.ledger.load(tenantId, [forMonth], { studentId });
    const me = loaded.students[0];
    const due = me ? loaded.due(me, forMonth) : { expected: 0, discount: 0, paid: 0, debt: 0 };
    return { monthlyPrice, forMonth, expected: due.expected, paid: due.paid, debt: due.debt, hasDebt: due.debt > 0 };
  }
}
