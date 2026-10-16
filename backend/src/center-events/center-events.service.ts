import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { centerEvents, rooms } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { effectiveAccess } from '../access/catalog';
import { lockTimetable } from '../common/timetable-lock';
import { isDate } from '../lessons/occurrences';
import { ConflictViewer, ScheduleConflict, ScheduleService } from '../schedule/schedule.service';
import { CreateCenterEventDto, ListCenterEventsDto, UpdateCenterEventDto } from './center-events.dto';

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
type Executor = Database | Tx;

/** The longest stretch one list request may cover. */
const MAX_RANGE_DAYS = 120;

// Days between two dates already checked with isDate.
const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/**
 * What the event's author may read about what is in the way. The room and
 * the time are theirs to know; which group or event holds it is the
 * timetable, shown to those who may see the timetable (schedule.view).
 */
function eventClashes(conflicts: ScheduleConflict[], viewer?: ConflictViewer) {
  const access = viewer?.role ? effectiveAccess(viewer.role, viewer.access) : [];
  const seesTimetable = access.includes('schedule.view');
  return conflicts.map((c) => {
    if (seesTimetable) return { type: c.type, message: c.message, startTime: c.startTime, endTime: c.endTime, date: c.date ?? null, roomName: c.roomName };
    const what = c.type === 'EVENT' ? 'boshqa tadbir' : c.type === 'MAKEUP' ? 'qoplash darsi' : 'dars';
    return { type: c.type, message: `Xona bu vaqtda band: ${what} (${c.startTime} - ${c.endTime})`, startTime: c.startTime, endTime: c.endTime, date: c.date ?? null };
  });
}

/**
 * Meetings, competitions and other one-off events of a center, shown beside
 * the lessons on the timetable. An online event carries its link, an offline
 * one a room of the center or a free-text place.
 */
@Injectable()
export class CenterEventsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly schedule: ScheduleService,
  ) {}

  async list(tenantId: string, q: ListCenterEventsDto) {
    if (!isDate(q.from) || !isDate(q.to)) throw new BadRequestException("Sana noto'g'ri");
    const span = dayNumber(q.to) - dayNumber(q.from);
    if (!(span >= 0)) throw new BadRequestException('"from" sanasi "to" dan keyin bo\'lmasin');
    if (span > MAX_RANGE_DAYS) throw new BadRequestException(`Bir so'rovda ${MAX_RANGE_DAYS} kundan oshmasin`);
    return this.db.query.centerEvents.findMany({
      where: and(eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt), gte(centerEvents.date, q.from), lte(centerEvents.date, q.to)),
      with: { room: { columns: { id: true, name: true } } },
      orderBy: [asc(centerEvents.date), asc(centerEvents.startTime)],
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCenterEventDto, viewer?: ConflictViewer) {
    const fields = {
      title: dto.title,
      kind: dto.kind,
      format: dto.format,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime ?? null,
      roomId: dto.roomId || null,
      location: dto.location ?? null,
      meetingUrl: dto.meetingUrl ?? null,
      audience: dto.audience ?? 'STAFF',
      description: dto.description ?? null,
    };
    const created = await this.db.transaction(async (tx) => {
      await lockTimetable(tx, tenantId);
      const row = await this.checked(tx, tenantId, fields);
      await this.assertRoomFree(tx, tenantId, row, viewer);
      const [inserted] = await tx.insert(centerEvents).values({ ...row, tenantId, createdByUserId: userId }).returning();
      return inserted;
    });
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'center_event', entityId: created.id, meta: { title: created.title, date: created.date } });
    return created;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCenterEventDto, viewer?: ConflictViewer) {
    const updated = await this.db.transaction(async (tx) => {
      // The event as it is now, read after the lock: another edit may have landed.
      await lockTimetable(tx, tenantId);
      const current = await this.find(tx, tenantId, id);
      const merged = {
        title: dto.title ?? current.title,
        kind: dto.kind ?? current.kind,
        format: dto.format ?? current.format,
        date: dto.date ?? current.date,
        startTime: dto.startTime ?? current.startTime,
        endTime: dto.endTime !== undefined ? dto.endTime : current.endTime,
        roomId: dto.roomId !== undefined ? dto.roomId || null : current.roomId,
        location: dto.location !== undefined ? dto.location : current.location,
        meetingUrl: dto.meetingUrl !== undefined ? dto.meetingUrl : current.meetingUrl,
        audience: dto.audience ?? current.audience,
        description: dto.description !== undefined ? dto.description : current.description,
      };
      const row = await this.checked(tx, tenantId, merged);
      await this.assertRoomFree(tx, tenantId, row, viewer, id);
      const [saved] = await tx
        .update(centerEvents)
        .set({ ...row, updatedAt: new Date() })
        .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)))
        .returning();
      if (!saved) throw new NotFoundException('Tadbir topilmadi');
      return saved;
    });
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'center_event', entityId: id });
    return updated;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const [gone] = await this.db.transaction(async (tx) => {
      // Freeing the room is a timetable write like taking it: one at a time.
      await lockTimetable(tx, tenantId);
      return tx
        .update(centerEvents)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)))
        .returning({ id: centerEvents.id, title: centerEvents.title });
    });
    if (!gone) throw new NotFoundException('Tadbir topilmadi');
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'center_event', entityId: id, meta: { title: gone.title } });
    return { ok: true };
  }

  private async find(db: Executor, tenantId: string, id: string) {
    const [row] = await db
      .select()
      .from(centerEvents)
      .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)));
    if (!row) throw new NotFoundException('Tadbir topilmadi');
    return row;
  }

  /**
   * Called inside the caller's transaction, after lockTimetable.
   *
   * An event in a room holds it like a lesson does: no lesson, make-up
   * session or other event in that room may overlap it (10:00-11:00 and
   * 11:00-12:00 do not). Runs under the center's timetable lock - the one
   * every timetable, make-up and event write takes first - and then the
   * room's own lock (the one trial lessons and make-up sessions take), so two
   * bookings of one room at one time cannot both pass the check.
   */
  private async assertRoomFree(
    tx: Tx,
    tenantId: string,
    row: { roomId: string | null; date: string; startTime: string; endTime: string | null },
    viewer?: ConflictViewer,
    excludeEventId?: string,
  ) {
    if (!row.roomId) return;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`trial:r:${tenantId}:${row.roomId}`}))`);
    const conflicts = await this.schedule.findConflicts(tenantId, {
      groupId: '__event__', roomId: row.roomId, date: row.date, startTime: row.startTime, endTime: row.endTime!, checkMakeups: true, excludeEventId,
    }, tx);
    if (conflicts.length > 0) {
      throw new ConflictException({ code: 'ROOM_TAKEN', message: 'Xona bu vaqtda band', conflicts: eventClashes(conflicts, viewer) });
    }
  }

  /** The event as it will be stored: times in order, a place that fits the format. */
  private async checked(
    tx: Tx,
    tenantId: string,
    e: {
      title: string; kind: string; format: string; date: string; startTime: string; endTime: string | null;
      roomId: string | null; location: string | null; meetingUrl: string | null; audience: string; description: string | null;
    },
  ) {
    const title = e.title.trim();
    if (title.length < 2) throw new BadRequestException('Tadbir nomini yozing');
    if (!isDate(e.date)) throw new BadRequestException('Sana noto\'g\'ri');
    if (e.endTime && e.endTime <= e.startTime) throw new BadRequestException('Tugash vaqti boshlanishdan keyin bo\'lsin');
    const online = e.format === 'ONLINE';
    let meetingUrl = e.meetingUrl?.trim() || null;
    if (online && meetingUrl) {
      let ok = false;
      try {
        const u = new URL(meetingUrl);
        ok = u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        ok = false;
      }
      if (!ok) throw new BadRequestException('Havola http(s):// bilan boshlanishi kerak');
    }
    if (!online) meetingUrl = null;
    let roomId = online ? null : e.roomId;
    if (roomId) {
      const [room] = await tx.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.tenantId, tenantId)));
      if (!room) throw new BadRequestException('Xona topilmadi');
      // How long the room is taken is not guessed: an event in a room says when it ends.
      if (!e.endTime) throw new BadRequestException({ code: 'END_TIME_REQUIRED', message: 'Xona tanlangan tadbir uchun tugash vaqtini kiriting' });
    } else {
      roomId = null;
    }
    return {
      title,
      kind: e.kind,
      format: e.format,
      date: e.date,
      startTime: e.startTime,
      endTime: e.endTime || null,
      roomId,
      location: online ? null : e.location?.trim() || null,
      meetingUrl,
      audience: e.audience,
      description: e.description?.trim() || null,
    };
  }
}
