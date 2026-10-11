import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { groups, lessonCancellations, makeupBookings, makeupCredits } from '../db/schema';
import { lockTimetable } from '../common/timetable-lock';
import { redactConflicts, ScheduleService, type ConflictViewer } from '../schedule/schedule.service';
import { CalendarChanges } from './calendar-changes';
import { addDays, isDate, lessonOccurrences, lessonsOfGroupOn } from './occurrences';

const MAX_RANGE_DAYS = 120;

@Injectable()
export class LessonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly changes: CalendarChanges,
    private readonly schedule: ScheduleService,
  ) {}

  private range(from: string, to: string) {
    if (!isDate(from) || !isDate(to) || to < from) throw new BadRequestException("Sana oralig'i noto'g'ri (YYYY-MM-DD)");
    if (to > addDays(from, MAX_RANGE_DAYS)) throw new BadRequestException(`Ko'pi bilan ${MAX_RANGE_DAYS} kun`);
  }

  /** Dated lessons (cancelled ones flagged) for the schedule and the make-up booking form. */
  async list(tenantId: string, from: string, to: string, groupId?: string) {
    this.range(from, to);
    return lessonOccurrences(this.db, tenantId, from, to, groupId ? [groupId] : undefined);
  }

  async cancellations(tenantId: string, from: string, to: string) {
    this.range(from, to);
    return this.db.select().from(lessonCancellations)
      .where(and(eq(lessonCancellations.tenantId, tenantId), gte(lessonCancellations.date, from), lte(lessonCancellations.date, to)));
  }

  /**
   * Calls off one dated lesson of a group: the lesson named by `scheduleId`
   * (its timetable row), or the group's only weekly lesson that day. A group
   * with several lessons that day has to say which. Make-up bookings into
   * that lesson - not into the group's other lessons that day - are
   * cancelled with it and their credits released (ISSUED again).
   */
  async cancel(tenantId: string, userId: string, dto: { groupId: string; date: string; scheduleId?: string; reason?: string }) {
    if (!isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const [group] = await this.db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)));
    if (!group) throw new NotFoundException('Guruh topilmadi');
    const result = await this.db.transaction(async (tx) => {
      // After the lock, so that a make-up being booked into this lesson is
      // either already there (and released below) or sees the cancellation.
      await lockTimetable(tx, tenantId);
      const weekly = (await lessonsOfGroupOn(tx, tenantId, dto.groupId, dto.date, true)).filter((l) => l.kind === 'WEEKLY');
      if (weekly.length === 0) throw new BadRequestException("Bu kuni guruhning haftalik darsi yo'q");
      const lesson = dto.scheduleId ? weekly.find((l) => l.scheduleId === dto.scheduleId) : weekly.length === 1 ? weekly[0] : null;
      if (!lesson) {
        throw new BadRequestException(dto.scheduleId
          ? { code: 'NO_LESSON', message: "Bu kuni guruhning bunday darsi yo'q" }
          : { code: 'LESSON_AMBIGUOUS', message: 'Bu kuni guruhning bir nechta darsi bor: qaysi biri ekanini tanlang', lessons: weekly.map((l) => ({ scheduleId: l.scheduleId, startTime: l.startTime, endTime: l.endTime, cancelled: l.cancelled })) });
      }
      if (lesson.cancelled) throw new ConflictException({ code: 'ALREADY_CANCELLED', message: 'Bu dars allaqachon bekor qilingan' });
      const [row] = await tx.insert(lessonCancellations)
        .values({ tenantId, groupId: dto.groupId, date: dto.date, scheduleId: lesson.scheduleId, reason: dto.reason?.trim().slice(0, 300) || null, cancelledByUserId: userId })
        .onConflictDoNothing().returning();
      if (!row) throw new ConflictException({ code: 'ALREADY_CANCELLED', message: 'Bu dars allaqachon bekor qilingan' });
      // Make-ups booked into this lesson cannot happen: cancel them, release
      // the credits. Bound to this row, or - a booking with no row - at this
      // lesson's start; the group's other lessons that day keep theirs.
      const released = await tx.update(makeupBookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: userId, note: 'LESSON_CANCELLED', updatedAt: new Date() })
        .where(and(
          eq(makeupBookings.tenantId, tenantId), eq(makeupBookings.targetGroupId, dto.groupId), eq(makeupBookings.date, dto.date), eq(makeupBookings.status, 'BOOKED'),
          lesson.scheduleId
            ? or(eq(makeupBookings.targetScheduleId, lesson.scheduleId), and(isNull(makeupBookings.targetScheduleId), eq(makeupBookings.startTime, lesson.startTime)))
            : undefined,
        ))
        .returning({ creditId: makeupBookings.creditId });
      if (released.length) {
        await tx.update(makeupCredits).set({ status: 'ISSUED', updatedAt: new Date() })
          .where(and(inArray(makeupCredits.id, released.map((r) => r.creditId)), eq(makeupCredits.status, 'BOOKED')));
      }
      return { cancellation: row, releasedBookings: released.length };
    });
    this.audit.log({ tenantId, userId, action: 'lesson.cancel', entityType: 'group', entityId: dto.groupId, meta: { date: dto.date, scheduleId: result.cancellation.scheduleId, releasedBookings: result.releasedBookings } });
    await this.changes.touch(tenantId);
    return result;
  }

  /**
   * Puts a cancelled lesson back - unless make-up credits were issued for
   * it, or its time was given to something else meanwhile (a one-off lesson
   * or a make-up on that date: a cancelled lesson holds nothing up).
   * Bookings released by the cancellation stay cancelled.
   */
  async restore(tenantId: string, userId: string, id: string, viewer?: ConflictViewer) {
    const row = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const [found] = await tx.select().from(lessonCancellations).where(and(eq(lessonCancellations.id, id), eq(lessonCancellations.tenantId, tenantId)));
      if (!found) throw new NotFoundException('Topilmadi');
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(makeupCredits)
        .where(and(
          eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.originGroupId, found.groupId), eq(makeupCredits.originDate, found.date),
          eq(makeupCredits.reason, 'LESSON_CANCELLED'), ne(makeupCredits.status, 'CANCELLED'),
          found.scheduleId ? eq(makeupCredits.originScheduleId, found.scheduleId) : isNull(makeupCredits.originScheduleId),
        ));
      if (n > 0) throw new ConflictException({ code: 'CREDITS_ISSUED', message: "Bu dars uchun qoplash kreditlari berilgan: avval ularni bekor qiling" });
      const back = (await lessonsOfGroupOn(tx, tenantId, found.groupId, found.date, true)).filter((l) => l.cancellationId === found.id);
      for (const lesson of back) {
        const conflicts = (await this.schedule.findConflicts(tenantId, {
          checkStudents: true, checkMakeups: true, groupId: lesson.groupId, teacherId: lesson.teacherId, roomId: lesson.roomId,
          date: lesson.date, startTime: lesson.startTime, endTime: lesson.endTime, excludeScheduleId: lesson.scheduleId ?? undefined,
        }, tx)).filter((c) => !!c.date);
        if (conflicts.length) {
          throw new ConflictException({ code: 'RESTORE_CONFLICT', message: `Darsni tiklab bo'lmaydi: ${redactConflicts(conflicts, viewer)[0].message}`, conflicts: redactConflicts(conflicts, viewer) });
        }
      }
      await tx.delete(lessonCancellations).where(and(eq(lessonCancellations.id, id), eq(lessonCancellations.tenantId, tenantId)));
      return found;
    });
    this.audit.log({ tenantId, userId, action: 'lesson.restore', entityType: 'group', entityId: row.groupId, meta: { date: row.date, scheduleId: row.scheduleId } });
    await this.changes.touch(tenantId);
    return { success: true };
  }
}
