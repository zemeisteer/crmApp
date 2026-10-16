import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import {
  attendance, branches, enrollments, groups, lessonCancellations, makeupBookings, makeupCredits, rooms, schedules, students, teachers, tenants,
} from '../db/schema';
import { countOccupiedSeats } from '../common/seats';
import { teacherGroupIds } from '../common/teacher-scope';
import { lockTimetable } from '../common/timetable-lock';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts, zonedTimeToUtc } from '../common/timezone';
import { effectiveAccess } from '../access/catalog';
import { absenceCounts, cancelledLessonCounts } from './eligibility';
import { staysByMember, staysOf } from '../enrollments/membership';
import { isOverlapping, ScheduleService } from '../schedule/schedule.service';
import { CalendarChanges } from '../lessons/calendar-changes';
import { addDays, isDate, lessonOccurrences, lessonsOfGroupOn } from '../lessons/occurrences';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export interface Viewer { role?: string; userId?: string }

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// How far a make-up may be booked: a little in the past (recorded after the
// fact), half a year ahead.
const BOOK_PAST_DAYS = 30;
const BOOK_AHEAD_DAYS = 180;
const LIVE_BOOKING = ['BOOKED', 'ATTENDED'];

export interface BookDto {
  mode: 'GROUP_LESSON' | 'SESSION';
  targetGroupId?: string;
  /** GROUP_LESSON: the lesson itself (its timetable row), as GET /lessons gives it. */
  scheduleId?: string;
  date: string;
  startTime?: string;
  endTime?: string;
  teacherId?: string;
  roomId?: string;
  note?: string;
  /**
   * A correction of the record: the make-up was held in a lesson that has
   * already begun (or is over) and is entered afterwards. Needs the
   * makeups.correct access and a reason; audited as such. Without it a
   * booking is for a lesson that has not begun yet - checked at the moment
   * of saving, in the center's time zone, for both modes.
   */
  historical?: boolean;
  reason?: string;
}

/**
 * Make-up lessons. A credit is owed for one missed occurrence (group,
 * date) - an absence or a lesson the center called off - and is issued by
 * staff, never automatically. It has no cash value: invoices, payments and
 * the ledger are never touched, and make-up sessions are not added to
 * teacher payroll. The original attendance row is never changed.
 *
 * Concurrency: a booking, its cancellation and its attendance mark each run
 * in one transaction that first takes the center's timetable lock (the one
 * timetable edits and lesson cancellations take, common/timetable-lock.ts),
 * then locks the credit (or booking) row, then the advisory locks for the
 * teacher and room (the same keys lead trials use, in the same order), the
 * target lesson and the student. Everything a decision rests on - the
 * lesson, the seats, who is busy - is read after the locks; status changes
 * are conditional on the status just read. Partial unique indexes back this up: one live credit per
 * occurrence, one live booking per credit.
 */
@Injectable()
export class MakeupsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly schedule: ScheduleService,
    private readonly changes: CalendarChanges,
  ) {}

  private async zone(db: Pick<Database, 'select'>, tenantId: string) {
    const [t] = await db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return isValidTimeZone(t?.tz) ? t.tz : DEFAULT_TIMEZONE;
  }

  private async today(tenantId: string) {
    const [t] = await this.db.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    const p = zonedParts(new Date(), t?.tz || DEFAULT_TIMEZONE);
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  /** The teacher row of a TEACHER viewer (null for other roles). */
  private async teacherOf(tenantId: string, viewer?: Viewer) {
    if (viewer?.role !== 'TEACHER') return null;
    const [t] = await this.db.select({ id: teachers.id }).from(teachers)
      .where(and(eq(teachers.tenantId, tenantId), eq(teachers.userId, viewer.userId ?? ''), isNull(teachers.deletedAt)));
    return t?.id ?? '';
  }

  // ---- lists --------------------------------------------------------------

  /**
   * Missed occurrences that may earn a credit: ABSENT marks and lessons the
   * center called off (for the students enrolled then), with the credit
   * already issued for each, if any. A teacher sees only their own groups.
   */
  async eligible(tenantId: string, from: string, to: string, viewer?: Viewer) {
    if (!isDate(from) || !isDate(to) || to < from || to > addDays(from, 120)) throw new BadRequestException("Sana oralig'i noto'g'ri");
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope && scope.length === 0) return [];
    const tz = await this.zone(this.db, tenantId);
    const marks = await this.db.select({
      studentId: attendance.studentId, groupId: attendance.groupId, date: attendance.date, createdAt: attendance.createdAt,
      scheduleId: attendance.scheduleId, startTime: attendance.startTime,
      studentName: students.fullName, groupName: groups.name,
    }).from(attendance)
      .innerJoin(students, eq(students.id, attendance.studentId))
      .innerJoin(groups, eq(groups.id, attendance.groupId))
      .where(and(eq(attendance.tenantId, tenantId), eq(attendance.status, 'ABSENT'), gte(attendance.date, from), lte(attendance.date, to), isNull(students.deletedAt), scope ? inArray(attendance.groupId, scope) : undefined));
    const cancels = await this.db.select().from(lessonCancellations)
      .where(and(eq(lessonCancellations.tenantId, tenantId), gte(lessonCancellations.date, from), lte(lessonCancellations.date, to), scope ? inArray(lessonCancellations.groupId, scope) : undefined));
    const groupIds = [...new Set([...marks.map((m) => m.groupId), ...cancels.map((c) => c.groupId)])];
    const enrolled = groupIds.length === 0 ? [] : await this.db.select({
      studentId: enrollments.studentId, groupId: enrollments.groupId, status: enrollments.status, joinedAt: enrollments.joinedAt, leftAt: enrollments.leftAt,
      studentName: students.fullName, groupName: groups.name,
    }).from(enrollments)
      .innerJoin(students, eq(students.id, enrollments.studentId))
      .innerJoin(groups, eq(groups.id, enrollments.groupId))
      .where(and(inArray(enrollments.groupId, groupIds), isNull(students.deletedAt), eq(groups.tenantId, tenantId)));
    // Who was in which group when: the membership history, the same the issue API asks.
    const stays = staysByMember(await staysOf(this.db, tenantId, { groupIds }));
    const staysOfMember = (studentId: string, groupId: string) => stays.get(`${studentId}|${groupId}`) ?? [];
    const lessonRows = cancels.some((c) => c.scheduleId)
      ? await this.db.select({ id: schedules.id, startTime: schedules.startTime }).from(schedules).where(inArray(schedules.id, cancels.map((c) => c.scheduleId).filter((x): x is string => !!x)))
      : [];
    const lessonStart = new Map(lessonRows.map((r) => [r.id, r.startTime]));

    // One row per missed lesson: an absence is per lesson now, like a cancellation.
    type Row = { studentId: string; groupId: string; date: string; studentName: string; groupName: string; reason: 'ABSENT' | 'LESSON_CANCELLED'; scheduleId: string | null; startTime: string | null };
    const rows: Row[] = [];
    for (const m of marks) {
      if (!absenceCounts(m, staysOfMember(m.studentId, m.groupId), { date: m.date, startTime: m.startTime }, tz)) continue;
      rows.push({ studentId: m.studentId, groupId: m.groupId, date: m.date, studentName: m.studentName, groupName: m.groupName, reason: 'ABSENT', scheduleId: m.scheduleId, startTime: m.startTime });
    }
    for (const c of cancels) {
      for (const e of enrolled.filter((x) => x.groupId === c.groupId)) {
        const startTime = c.scheduleId ? lessonStart.get(c.scheduleId) ?? null : null;
        if (!cancelledLessonCounts(staysOfMember(e.studentId, c.groupId), { date: c.date, startTime }, tz)) continue;
        rows.push({ studentId: e.studentId, groupId: c.groupId, date: c.date, studentName: e.studentName, groupName: e.groupName, reason: 'LESSON_CANCELLED', scheduleId: c.scheduleId, startTime });
      }
    }
    if (rows.length === 0) return [];
    const credits = await this.db.select({ id: makeupCredits.id, status: makeupCredits.status, studentId: makeupCredits.studentId, groupId: makeupCredits.originGroupId, date: makeupCredits.originDate, scheduleId: makeupCredits.originScheduleId })
      .from(makeupCredits)
      .where(and(eq(makeupCredits.tenantId, tenantId), ne(makeupCredits.status, 'CANCELLED'), inArray(makeupCredits.studentId, [...new Set(rows.map((r) => r.studentId))])));
    const byKey = new Map(credits.map((c) => [`${c.studentId}|${c.groupId}|${c.date}|${c.scheduleId ?? ''}`, { id: c.id, status: c.status }]));
    return rows
      .map((r) => ({ ...r, credit: byKey.get(`${r.studentId}|${r.groupId}|${r.date}|${r.scheduleId ?? ''}`) ?? null }))
      .sort((a, b) => b.date.localeCompare(a.date) || a.studentName.localeCompare(b.studentName));
  }

  async credits(tenantId: string, q: { status?: string; studentId?: string }, viewer?: Viewer) {
    const scope = await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId);
    if (scope && scope.length === 0) return [];
    const list = await this.db.query.makeupCredits.findMany({
      where: and(
        eq(makeupCredits.tenantId, tenantId),
        q.status ? eq(makeupCredits.status, q.status) : undefined,
        q.studentId ? eq(makeupCredits.studentId, q.studentId) : undefined,
        scope ? inArray(makeupCredits.originGroupId, scope) : undefined,
      ),
      with: {
        student: { columns: { id: true, fullName: true, phone: true } },
        originGroup: { columns: { id: true, name: true } },
        bookings: {
          orderBy: desc(makeupBookings.createdAt),
          with: { targetGroup: { columns: { id: true, name: true } }, teacher: { columns: { id: true, fullName: true } }, room: { columns: { id: true, name: true } } },
        },
      },
      orderBy: desc(makeupCredits.issuedAt),
      limit: 500,
    });
    const now = Date.now();
    return list.map((c) => ({ ...c, expired: c.status === 'ISSUED' && !!c.expiresAt && c.expiresAt.getTime() < now }));
  }

  /**
   * Bookings someone teaches (a teacher: sessions they run and make-ups in
   * their groups, with the student's name only) or all of them (staff).
   */
  async roster(tenantId: string, from: string, to: string, viewer?: Viewer) {
    if (!isDate(from) || !isDate(to) || to < from || to > addDays(from, 120)) throw new BadRequestException("Sana oralig'i noto'g'ri");
    const teacherId = await this.teacherOf(tenantId, viewer);
    const myGroups = teacherId !== null ? ((await teacherGroupIds(this.db, tenantId, viewer?.role, viewer?.userId)) ?? []) : null;
    if (teacherId === '') return [];
    const mine = teacherId !== null
      ? or(eq(makeupBookings.teacherId, teacherId), myGroups && myGroups.length ? inArray(makeupBookings.targetGroupId, myGroups) : sql`false`)
      : undefined;
    return this.db.select({
      id: makeupBookings.id, creditId: makeupBookings.creditId, mode: makeupBookings.mode, date: makeupBookings.date,
      startTime: makeupBookings.startTime, endTime: makeupBookings.endTime, status: makeupBookings.status,
      student: { id: students.id, fullName: students.fullName },
      targetGroupId: makeupBookings.targetGroupId, groupName: groups.name,
      teacherId: makeupBookings.teacherId, roomId: makeupBookings.roomId,
    }).from(makeupBookings)
      .innerJoin(students, eq(students.id, makeupBookings.studentId))
      .leftJoin(groups, eq(groups.id, makeupBookings.targetGroupId))
      .where(and(eq(makeupBookings.tenantId, tenantId), gte(makeupBookings.date, from), lte(makeupBookings.date, to), ne(makeupBookings.status, 'CANCELLED'), mine))
      .orderBy(makeupBookings.date, makeupBookings.startTime);
  }

  // ---- credits ------------------------------------------------------------

  /**
   * A credit for one missed lesson. What it rests on is read in the same
   * transaction that writes it, under the timetable lock - the lock a
   * cancelled lesson's restore takes - so the two cannot pass each other:
   * either the credit is there and the restore is refused, or the lesson is
   * back and there is nothing to give a credit for. The absence mark is
   * read FOR SHARE: a correction of that mark waits, and then settles the
   * credit (eligibility.ts settleAbsenceCredits). Who counts as having
   * missed the lesson: eligibility.ts, the same functions the list uses.
   */
  async issue(tenantId: string, userId: string, dto: { studentId: string; groupId: string; date: string; reason: 'ABSENT' | 'LESSON_CANCELLED'; scheduleId?: string; note?: string }) {
    if (!isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const credit = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [student] = await tx.select({ id: students.id }).from(students).where(and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId), isNull(students.deletedAt)));
      if (!student) throw new NotFoundException("O'quvchi topilmadi");
      const [group] = await tx.select({ id: groups.id }).from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)));
      if (!group) throw new NotFoundException('Guruh topilmadi');
      const tz = await this.zone(tx, tenantId);
      const stays = await staysOf(tx, tenantId, { studentIds: [dto.studentId], groupIds: [dto.groupId] });
      let originScheduleId: string | null = null;
      if (dto.reason === 'ABSENT') {
        // The absence itself: of the lesson named, or the student's only absence in the group that day.
        const marks = await tx.select({ id: attendance.id, createdAt: attendance.createdAt, scheduleId: attendance.scheduleId, startTime: attendance.startTime }).from(attendance)
          .where(and(eq(attendance.tenantId, tenantId), eq(attendance.studentId, dto.studentId), eq(attendance.groupId, dto.groupId), eq(attendance.date, dto.date), eq(attendance.status, 'ABSENT')))
          .for('share');
        if (marks.length === 0) throw new BadRequestException({ code: 'NOT_ELIGIBLE', message: "Bu kuni o'quvchi darsda yo'q deb belgilanmagan" });
        const mark = dto.scheduleId ? marks.find((m) => m.scheduleId === dto.scheduleId) : marks.length === 1 ? marks[0] : null;
        if (!mark) {
          throw new BadRequestException(dto.scheduleId
            ? { code: 'NOT_ELIGIBLE', message: "Bu darsda o'quvchi yo'q deb belgilanmagan" }
            : { code: 'LESSON_AMBIGUOUS', message: "Bu kuni o'quvchi bir nechta darsda yo'q deb belgilangan: qaysi biri ekanini tanlang" });
        }
        originScheduleId = mark.scheduleId;
        if (!absenceCounts(mark, stays, { date: dto.date, startTime: mark.startTime }, tz)) throw new BadRequestException({ code: 'NOT_ELIGIBLE', message: "O'quvchi o'sha darsda bu guruhda bo'lmagan" });
      } else {
        const cancels = await tx.select({ id: lessonCancellations.id, scheduleId: lessonCancellations.scheduleId }).from(lessonCancellations)
          .where(and(eq(lessonCancellations.tenantId, tenantId), eq(lessonCancellations.groupId, dto.groupId), eq(lessonCancellations.date, dto.date)));
        if (cancels.length === 0) throw new BadRequestException({ code: 'NOT_ELIGIBLE', message: 'Bu kungi dars bekor qilinmagan' });
        const cancellation = dto.scheduleId ? cancels.find((c) => c.scheduleId === dto.scheduleId) : cancels.length === 1 ? cancels[0] : null;
        if (!cancellation) {
          throw new BadRequestException(dto.scheduleId
            ? { code: 'NOT_ELIGIBLE', message: 'Bu dars bekor qilinmagan' }
            : { code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bekor qilingan: qaysi biri ekanini tanlang' });
        }
        const [row] = cancellation.scheduleId ? await tx.select({ startTime: schedules.startTime }).from(schedules).where(eq(schedules.id, cancellation.scheduleId)) : [];
        if (!cancelledLessonCounts(stays, { date: dto.date, startTime: row?.startTime }, tz)) throw new BadRequestException({ code: 'NOT_ELIGIBLE', message: "O'quvchi o'sha darsda bu guruhda bo'lmagan" });
        originScheduleId = cancellation.scheduleId;
      }
      const [t] = await tx.select({ days: tenants.makeupCreditDays }).from(tenants).where(eq(tenants.id, tenantId));
      const expiresAt = t?.days ? new Date(Date.now() + t.days * 86_400_000) : null;
      const [row] = await tx.insert(makeupCredits).values({
        tenantId, studentId: dto.studentId, originGroupId: dto.groupId, originDate: dto.date, originScheduleId, reason: dto.reason,
        note: dto.note?.trim().slice(0, 500) || null, issuedByUserId: userId, expiresAt,
      }).returning();
      return row;
    }).catch((err) => {
      if (isUnique(err, 'makeup_credits_once_per_occurrence') || isUnique(err, 'makeup_credits_once_per_lesson')) {
        throw new ConflictException({ code: 'DUPLICATE_CREDIT', message: 'Bu dars uchun kredit allaqachon berilgan' });
      }
      throw err;
    });
    this.audit.log({ tenantId, userId, action: 'makeup.issue', entityType: 'makeup_credit', entityId: credit.id, meta: { studentId: dto.studentId, groupId: dto.groupId, date: dto.date, reason: dto.reason, scheduleId: credit.originScheduleId } });
    return credit;
  }

  private async lockCredit(tx: Tx, tenantId: string, id: string) {
    const [c] = await tx.select().from(makeupCredits).where(and(eq(makeupCredits.id, id), eq(makeupCredits.tenantId, tenantId))).for('update');
    if (!c) throw new NotFoundException('Kredit topilmadi');
    return c;
  }

  /** Voids an unused credit (frees the occurrence for a new one). */
  async cancelCredit(tenantId: string, userId: string, id: string) {
    const credit = await this.db.transaction(async (tx) => {
      const c = await this.lockCredit(tx, tenantId, id);
      if (c.status !== 'ISSUED') throw new ConflictException({ code: 'CREDIT_NOT_OPEN', message: "Faqat foydalanilmagan kreditni bekor qilish mumkin" });
      const [row] = await tx.update(makeupCredits).set({ status: 'CANCELLED', closedAt: new Date(), closedByUserId: userId, updatedAt: new Date() })
        .where(and(eq(makeupCredits.id, id), eq(makeupCredits.status, 'ISSUED'))).returning();
      return row;
    });
    this.audit.log({ tenantId, userId, action: 'makeup.cancel_credit', entityType: 'makeup_credit', entityId: id });
    return credit;
  }

  /** A forfeited credit (missed make-up) back to usable - an explicit, audited decision. */
  async reinstate(tenantId: string, userId: string, id: string) {
    const credit = await this.db.transaction(async (tx) => {
      const c = await this.lockCredit(tx, tenantId, id);
      if (c.status !== 'FORFEITED') throw new ConflictException({ code: 'CREDIT_NOT_FORFEITED', message: "Faqat yo'qotilgan kreditni qayta tiklash mumkin" });
      const [row] = await tx.update(makeupCredits).set({ status: 'ISSUED', closedAt: null, closedByUserId: null, updatedAt: new Date() })
        .where(and(eq(makeupCredits.id, id), eq(makeupCredits.status, 'FORFEITED'))).returning();
      return row;
    });
    this.audit.log({ tenantId, userId, action: 'makeup.reinstate', entityType: 'makeup_credit', entityId: id });
    return credit;
  }

  // ---- bookings -----------------------------------------------------------

  async book(tenantId: string, userId: string, creditId: string, dto: BookDto, viewer?: { role?: string; access?: string[] | null }) {
    if (!isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const historical = dto.historical === true;
    const reason = dto.reason?.trim() ?? '';
    if (historical) {
      if (!viewer?.role || !effectiveAccess(viewer.role, viewer.access).includes('makeups.correct')) {
        throw new ForbiddenException({ code: 'CORRECTION_NOT_ALLOWED', message: "O'tgan darsga qoplashni yozish uchun ruxsat yo'q" });
      }
      if (reason.length < 5) throw new BadRequestException({ code: 'REASON_REQUIRED', message: "O'tgan darsga yozish sababini kiriting" });
    }
    const today = await this.today(tenantId);
    if (dto.date < addDays(today, -BOOK_PAST_DAYS) || dto.date > addDays(today, BOOK_AHEAD_DAYS)) {
      throw new BadRequestException(`Sana ${BOOK_PAST_DAYS} kun oldindan ${BOOK_AHEAD_DAYS} kun keyingacha bo'lishi kerak`);
    }
    const booking = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const credit = await this.lockCredit(tx, tenantId, creditId);
      if (credit.status !== 'ISSUED') throw new ConflictException({ code: 'CREDIT_NOT_OPEN', message: 'Kredit band yoki ishlatilgan' });
      if (credit.expiresAt && credit.expiresAt.getTime() < Date.now()) throw new ConflictException({ code: 'CREDIT_EXPIRED', message: 'Kredit muddati tugagan' });

      let slot: { targetGroupId: string | null; targetScheduleId: string | null; startTime: string; endTime: string; teacherId: string | null; roomId: string | null; branchId: string | null };
      if (dto.mode === 'GROUP_LESSON') {
        if (!dto.targetGroupId) throw new BadRequestException('Guruhni tanlang');
        const [g] = await tx.select().from(groups).where(and(eq(groups.id, dto.targetGroupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)));
        if (!g) throw new NotFoundException('Guruh topilmadi');
        const lessons = await lessonsOfGroupOn(tx, tenantId, g.id, dto.date);
        if (lessons.length === 0) throw new BadRequestException({ code: 'NO_LESSON', message: "Bu kuni guruhning darsi yo'q yoki bekor qilingan" });
        // The lesson that was chosen - by its timetable row, or by its start
        // when that names exactly one: a group with two lessons that day must
        // not have the make-up land in whichever comes first.
        const atStart = dto.startTime ? lessons.filter((l) => l.startTime === dto.startTime) : [];
        const lesson = dto.scheduleId ? lessons.find((l) => l.scheduleId === dto.scheduleId)
          : dto.startTime ? (atStart.length === 1 ? atStart[0] : null)
          : lessons.length === 1 ? lessons[0] : null;
        if (!lesson) {
          throw new BadRequestException(dto.scheduleId || (dto.startTime && atStart.length === 0)
            ? { code: 'NO_LESSON', message: "Bu vaqtda guruhning darsi yo'q yoki bekor qilingan" }
            : { code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bor: qaysi biri ekanini tanlang', lessons: lessons.map((l) => ({ scheduleId: l.scheduleId, startTime: l.startTime, endTime: l.endTime })) });
        }
        const [already] = await tx.select({ id: enrollments.id }).from(enrollments)
          .where(and(eq(enrollments.studentId, credit.studentId), eq(enrollments.groupId, g.id), eq(enrollments.status, 'ACTIVE')));
        if (already) throw new BadRequestException({ code: 'ALREADY_IN_GROUP', message: "O'quvchi bu guruhda o'qiydi: bu dars unga baribir" });
        slot = { targetGroupId: g.id, targetScheduleId: lesson.scheduleId, startTime: lesson.startTime, endTime: lesson.endTime, teacherId: lesson.teacherId, roomId: lesson.roomId, branchId: lesson.branchId };
      } else if (dto.mode === 'SESSION') {
        if (!dto.startTime || !dto.endTime || !TIME_RE.test(dto.startTime) || !TIME_RE.test(dto.endTime) || dto.endTime <= dto.startTime) {
          throw new BadRequestException("Vaqt noto'g'ri: HH:MM, tugashi boshlanishidan keyin");
        }
        if (!dto.teacherId) throw new BadRequestException("O'qituvchini tanlang");
        const [t] = await tx.select({ id: teachers.id }).from(teachers).where(and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)));
        if (!t) throw new NotFoundException("O'qituvchi topilmadi");
        let branchId: string | null = null;
        if (dto.roomId) {
          const [r] = await tx.select({ id: rooms.id, branchId: rooms.branchId }).from(rooms).where(and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)));
          if (!r) throw new NotFoundException('Xona topilmadi');
          branchId = r.branchId;
        }
        slot = { targetGroupId: null, targetScheduleId: null, startTime: dto.startTime, endTime: dto.endTime, teacherId: t.id, roomId: dto.roomId ?? null, branchId };
      } else {
        throw new BadRequestException("Turi noto'g'ri");
      }

      // Has the lesson begun? Now, in the center's zone - not when the form was opened.
      const [y, mo, d] = dto.date.split('-').map(Number);
      const [h, mi] = slot.startTime.split(':').map(Number);
      const begun = zonedTimeToUtc(y, mo, d, h, mi, await this.zone(tx, tenantId)).getTime() <= Date.now();
      if (begun && !historical) {
        throw new ConflictException({ code: 'LESSON_STARTED', message: "Dars boshlanib bo'lgan: unga qoplash yozib bo'lmaydi. Boshqa darsni tanlang" });
      }
      if (!begun && historical) {
        throw new BadRequestException({ code: 'NOT_HISTORICAL', message: "Dars hali boshlanmagan: oddiy yozuv qiling" });
      }

      // Same lock order as lead trials (teacher, room), then the lesson and the student.
      const keys = [
        slot.teacherId && `trial:t:${tenantId}:${slot.teacherId}`,
        slot.roomId && `trial:r:${tenantId}:${slot.roomId}`,
        slot.targetGroupId && `makeup:g:${slot.targetGroupId}:${dto.date}`,
        `makeup:s:${credit.studentId}`,
      ].filter(Boolean) as string[];
      for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);

      if (dto.mode === 'GROUP_LESSON') {
        const [g] = await tx.select({ maxStudents: groups.maxStudents }).from(groups).where(eq(groups.id, slot.targetGroupId!));
        const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(makeupBookings)
          .where(and(
            eq(makeupBookings.targetGroupId, slot.targetGroupId!), eq(makeupBookings.date, dto.date), inArray(makeupBookings.status, LIVE_BOOKING),
            // The seats of this lesson, not of the group's other lesson that day.
            slot.targetScheduleId
              ? or(eq(makeupBookings.targetScheduleId, slot.targetScheduleId), and(isNull(makeupBookings.targetScheduleId), eq(makeupBookings.startTime, slot.startTime)))
              : eq(makeupBookings.startTime, slot.startTime),
          ));
        const seats = await countOccupiedSeats(tx, slot.targetGroupId!);
        if (seats + n >= g.maxStudents) throw new ConflictException({ code: 'LESSON_FULL', message: "Bu darsda bo'sh o'rin yo'q" });
      } else {
        // The teacher and the room must be free: the timetable, and other make-up sessions.
        const conflicts = await this.schedule.findConflicts(tenantId, {
          groupId: '__makeup__', teacherId: slot.teacherId, roomId: slot.roomId, date: dto.date, startTime: slot.startTime, endTime: slot.endTime,
        }, tx);
        const sessions = await tx.select().from(makeupBookings)
          .where(and(eq(makeupBookings.tenantId, tenantId), eq(makeupBookings.date, dto.date), eq(makeupBookings.mode, 'SESSION'), inArray(makeupBookings.status, LIVE_BOOKING),
            or(eq(makeupBookings.teacherId, slot.teacherId!), slot.roomId ? eq(makeupBookings.roomId, slot.roomId) : sql`false`)));
        const busy = sessions.filter((s) => isOverlapping(s.startTime, s.endTime, slot.startTime, slot.endTime));
        if (conflicts.length || busy.length) {
          throw new ConflictException({ code: 'SLOT_TAKEN', message: "O'qituvchi yoki xona bu vaqtda band", conflicts: [...conflicts.map((c) => c.type), ...busy.map(() => 'MAKEUP')] });
        }
      }

      // The student must be free: other make-ups that day and their own lessons.
      const theirs = await tx.select().from(makeupBookings)
        .where(and(eq(makeupBookings.studentId, credit.studentId), eq(makeupBookings.date, dto.date), inArray(makeupBookings.status, LIVE_BOOKING)));
      const ownGroups = (await tx.select({ groupId: enrollments.groupId }).from(enrollments)
        .where(and(eq(enrollments.studentId, credit.studentId), eq(enrollments.status, 'ACTIVE')))).map((e) => e.groupId);
      const ownLessons = (await lessonOccurrences(tx, tenantId, dto.date, dto.date, ownGroups)).filter((o) => !o.cancelled);
      if ([...theirs, ...ownLessons].some((x) => isOverlapping(x.startTime, x.endTime, slot.startTime, slot.endTime))) {
        throw new ConflictException({ code: 'STUDENT_BUSY', message: "O'quvchi bu vaqtda boshqa darsda" });
      }

      const [row] = await tx.insert(makeupBookings).values({
        tenantId, creditId, studentId: credit.studentId, mode: dto.mode, targetGroupId: slot.targetGroupId, targetScheduleId: slot.targetScheduleId, date: dto.date,
        startTime: slot.startTime, endTime: slot.endTime, teacherId: slot.teacherId, roomId: slot.roomId, branchId: slot.branchId,
        note: dto.note?.trim().slice(0, 500) || null, createdByUserId: userId,
      }).returning();
      const moved = await tx.update(makeupCredits).set({ status: 'BOOKED', updatedAt: new Date() })
        .where(and(eq(makeupCredits.id, creditId), eq(makeupCredits.status, 'ISSUED'))).returning({ id: makeupCredits.id });
      if (moved.length !== 1) throw new ConflictException({ code: 'CREDIT_NOT_OPEN', message: 'Kredit band yoki ishlatilgan' });
      return row;
    }).catch((err) => {
      if (isUnique(err, 'makeup_bookings_one_live_per_credit')) throw new ConflictException({ code: 'CREDIT_NOT_OPEN', message: 'Kredit band yoki ishlatilgan' });
      throw err;
    });
    this.audit.log({
      tenantId, userId, action: historical ? 'makeup.book_historical' : 'makeup.book', entityType: 'makeup_booking', entityId: booking.id,
      meta: { creditId, mode: dto.mode, date: dto.date, ...(historical ? { reason } : {}) },
    });
    await this.changes.touch(tenantId);
    return booking;
  }

  private async lockBooking(tx: Tx, tenantId: string, id: string) {
    const [b] = await tx.select().from(makeupBookings).where(and(eq(makeupBookings.id, id), eq(makeupBookings.tenantId, tenantId))).for('update');
    if (!b) throw new NotFoundException('Topilmadi');
    return b;
  }

  /** Cancels a booked make-up; the credit is released (usable again). */
  async cancelBooking(tenantId: string, userId: string, id: string) {
    const booking = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const b = await this.lockBooking(tx, tenantId, id);
      await this.lockCredit(tx, tenantId, b.creditId);
      if (b.status !== 'BOOKED') throw new ConflictException({ code: 'BOOKING_CLOSED', message: "Faqat rejalashtirilgan qoplash darsini bekor qilish mumkin" });
      const [row] = await tx.update(makeupBookings).set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: userId, updatedAt: new Date() })
        .where(and(eq(makeupBookings.id, id), eq(makeupBookings.status, 'BOOKED'))).returning();
      await tx.update(makeupCredits).set({ status: 'ISSUED', updatedAt: new Date() }).where(and(eq(makeupCredits.id, b.creditId), eq(makeupCredits.status, 'BOOKED')));
      return row;
    });
    this.audit.log({ tenantId, userId, action: 'makeup.cancel_booking', entityType: 'makeup_booking', entityId: id });
    await this.changes.touch(tenantId);
    return booking;
  }

  /**
   * Attendance at the make-up: ATTENDED uses the credit, MISSED forfeits it
   * (staff may reinstate). Marked once; the teacher of the target lesson or
   * session may mark it, nothing else of that group's.
   */
  async mark(tenantId: string, viewer: Viewer & { userId: string }, id: string, status: 'ATTENDED' | 'MISSED') {
    if (status !== 'ATTENDED' && status !== 'MISSED') throw new BadRequestException("Holat noto'g'ri");
    const teacherId = await this.teacherOf(tenantId, viewer);
    const result = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const b = await this.lockBooking(tx, tenantId, id);
      if (teacherId !== null) {
        let mine = !!teacherId && b.teacherId === teacherId;
        if (!mine && b.targetGroupId) {
          const [g] = await tx.select({ teacherId: groups.teacherId }).from(groups).where(eq(groups.id, b.targetGroupId));
          mine = !!teacherId && g?.teacherId === teacherId;
        }
        // Same answer as a booking that does not exist.
        if (!mine) throw new NotFoundException('Topilmadi');
      }
      await this.lockCredit(tx, tenantId, b.creditId);
      if (b.status !== 'BOOKED') throw new ConflictException({ code: 'ALREADY_MARKED', message: 'Bu qoplash darsi allaqachon belgilangan yoki bekor qilingan' });
      const [row] = await tx.update(makeupBookings).set({ status, markedByUserId: viewer.userId, markedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(makeupBookings.id, id), eq(makeupBookings.status, 'BOOKED'))).returning();
      const next = status === 'ATTENDED' ? 'USED' : 'FORFEITED';
      const moved = await tx.update(makeupCredits).set({ status: next, closedAt: new Date(), closedByUserId: viewer.userId, updatedAt: new Date() })
        .where(and(eq(makeupCredits.id, b.creditId), eq(makeupCredits.status, 'BOOKED'))).returning({ id: makeupCredits.id });
      if (moved.length !== 1) throw new ConflictException({ code: 'ALREADY_MARKED', message: 'Bu qoplash darsi allaqachon belgilangan' });
      return row;
    });
    this.audit.log({ tenantId, userId: viewer.userId, action: 'makeup.attendance', entityType: 'makeup_booking', entityId: id, meta: { status } });
    return result;
  }

  // ---- cabinet ------------------------------------------------------------

  /** The student's own credits and make-ups (no other student, no staff notes). */
  async forStudent(tenantId: string, studentId: string) {
    const credits = await this.db.select({
      id: makeupCredits.id, originDate: makeupCredits.originDate, reason: makeupCredits.reason, status: makeupCredits.status, expiresAt: makeupCredits.expiresAt,
      originGroupName: groups.name,
    }).from(makeupCredits).leftJoin(groups, eq(groups.id, makeupCredits.originGroupId))
      .where(and(eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.studentId, studentId), ne(makeupCredits.status, 'CANCELLED')))
      .orderBy(desc(makeupCredits.issuedAt)).limit(50);
    const bookings = await this.db.select({
      id: makeupBookings.id, creditId: makeupBookings.creditId, mode: makeupBookings.mode, date: makeupBookings.date, startTime: makeupBookings.startTime,
      endTime: makeupBookings.endTime, status: makeupBookings.status, groupName: groups.name, teacherName: teachers.fullName, roomName: rooms.name, branchName: branches.name,
    }).from(makeupBookings)
      .leftJoin(groups, eq(groups.id, makeupBookings.targetGroupId))
      .leftJoin(teachers, eq(teachers.id, makeupBookings.teacherId))
      .leftJoin(rooms, eq(rooms.id, makeupBookings.roomId))
      .leftJoin(branches, eq(branches.id, makeupBookings.branchId))
      .where(and(eq(makeupBookings.tenantId, tenantId), eq(makeupBookings.studentId, studentId)))
      .orderBy(desc(makeupBookings.date)).limit(50);
    return { credits, bookings };
  }
}

function isUnique(err: unknown, constraint: string) {
  const e = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const c = e.cause ?? e;
  return c.code === '23505' && (!c.constraint || c.constraint === constraint);
}

