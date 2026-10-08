import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service';
import { DB, Database } from '../db/db.module';
import { groups, lessonCancellations, makeupBookings, makeupCredits } from '../db/schema';
import { CalendarChanges } from './calendar-changes';
import { addDays, isDate, lessonOccurrences, lessonsOfGroupOn } from './occurrences';

const MAX_RANGE_DAYS = 120;

@Injectable()
export class LessonsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly changes: CalendarChanges,
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
   * Calls off one dated lesson of a group. Make-up bookings into that lesson
   * are cancelled with it and their credits released (ISSUED again).
   */
  async cancel(tenantId: string, userId: string, dto: { groupId: string; date: string; reason?: string }) {
    if (!isDate(dto.date)) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    const [group] = await this.db.select({ id: groups.id }).from(groups).where(and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)));
    if (!group) throw new NotFoundException('Guruh topilmadi');
    const lessons = await lessonsOfGroupOn(this.db, tenantId, dto.groupId, dto.date, true);
    if (lessons.filter((l) => l.kind === 'WEEKLY').length === 0) throw new BadRequestException("Bu kuni guruhning haftalik darsi yo'q");
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx.insert(lessonCancellations)
        .values({ tenantId, groupId: dto.groupId, date: dto.date, reason: dto.reason?.trim().slice(0, 300) || null, cancelledByUserId: userId })
        .onConflictDoNothing().returning();
      if (!row) throw new ConflictException({ code: 'ALREADY_CANCELLED', message: 'Bu dars allaqachon bekor qilingan' });
      // Make-ups booked into this lesson cannot happen: cancel them, release the credits.
      const released = await tx.update(makeupBookings)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), cancelledByUserId: userId, note: 'LESSON_CANCELLED', updatedAt: new Date() })
        .where(and(eq(makeupBookings.tenantId, tenantId), eq(makeupBookings.targetGroupId, dto.groupId), eq(makeupBookings.date, dto.date), eq(makeupBookings.status, 'BOOKED')))
        .returning({ creditId: makeupBookings.creditId });
      if (released.length) {
        await tx.update(makeupCredits).set({ status: 'ISSUED', updatedAt: new Date() })
          .where(and(inArray(makeupCredits.id, released.map((r) => r.creditId)), eq(makeupCredits.status, 'BOOKED')));
      }
      return { cancellation: row, releasedBookings: released.length };
    });
    this.audit.log({ tenantId, userId, action: 'lesson.cancel', entityType: 'group', entityId: dto.groupId, meta: { date: dto.date, releasedBookings: result.releasedBookings } });
    await this.changes.touch(tenantId);
    return result;
  }

  /** Puts a cancelled lesson back - unless make-up credits were issued for it. */
  async restore(tenantId: string, userId: string, id: string) {
    const [row] = await this.db.select().from(lessonCancellations).where(and(eq(lessonCancellations.id, id), eq(lessonCancellations.tenantId, tenantId)));
    if (!row) throw new NotFoundException('Topilmadi');
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(makeupCredits)
      .where(and(eq(makeupCredits.tenantId, tenantId), eq(makeupCredits.originGroupId, row.groupId), eq(makeupCredits.originDate, row.date), eq(makeupCredits.reason, 'LESSON_CANCELLED'), ne(makeupCredits.status, 'CANCELLED')));
    if (n > 0) throw new ConflictException({ code: 'CREDITS_ISSUED', message: "Bu dars uchun qoplash kreditlari berilgan: avval ularni bekor qiling" });
    await this.db.delete(lessonCancellations).where(and(eq(lessonCancellations.id, id), eq(lessonCancellations.tenantId, tenantId)));
    this.audit.log({ tenantId, userId, action: 'lesson.restore', entityType: 'group', entityId: row.groupId, meta: { date: row.date } });
    await this.changes.touch(tenantId);
    return { success: true };
  }
}
