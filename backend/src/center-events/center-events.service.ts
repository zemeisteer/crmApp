import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { centerEvents, rooms } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CreateCenterEventDto, ListCenterEventsDto, UpdateCenterEventDto } from './center-events.dto';

/** The longest stretch one list request may cover. */
const MAX_RANGE_DAYS = 120;

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

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
  ) {}

  async list(tenantId: string, q: ListCenterEventsDto) {
    const span = dayNumber(q.to) - dayNumber(q.from);
    if (!(span >= 0)) throw new BadRequestException('"from" sanasi "to" dan keyin bo\'lmasin');
    if (span > MAX_RANGE_DAYS) throw new BadRequestException(`Bir so'rovda ${MAX_RANGE_DAYS} kundan oshmasin`);
    return this.db.query.centerEvents.findMany({
      where: and(eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt), gte(centerEvents.date, q.from), lte(centerEvents.date, q.to)),
      with: { room: { columns: { id: true, name: true } } },
      orderBy: [asc(centerEvents.date), asc(centerEvents.startTime)],
    });
  }

  async create(tenantId: string, userId: string, dto: CreateCenterEventDto) {
    const row = await this.checked(tenantId, {
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
    });
    const [created] = await this.db.insert(centerEvents).values({ ...row, tenantId, createdByUserId: userId }).returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'center_event', entityId: created.id, meta: { title: created.title, date: created.date } });
    return created;
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCenterEventDto) {
    const current = await this.find(tenantId, id);
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
    const row = await this.checked(tenantId, merged);
    const [updated] = await this.db
      .update(centerEvents)
      .set({ ...row, updatedAt: new Date() })
      .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)))
      .returning();
    if (!updated) throw new NotFoundException('Tadbir topilmadi');
    this.audit.log({ tenantId, userId, action: 'update', entityType: 'center_event', entityId: id });
    return updated;
  }

  async remove(tenantId: string, userId: string, id: string) {
    const [gone] = await this.db
      .update(centerEvents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)))
      .returning({ id: centerEvents.id, title: centerEvents.title });
    if (!gone) throw new NotFoundException('Tadbir topilmadi');
    this.audit.log({ tenantId, userId, action: 'delete', entityType: 'center_event', entityId: id, meta: { title: gone.title } });
    return { ok: true };
  }

  private async find(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(centerEvents)
      .where(and(eq(centerEvents.id, id), eq(centerEvents.tenantId, tenantId), isNull(centerEvents.deletedAt)));
    if (!row) throw new NotFoundException('Tadbir topilmadi');
    return row;
  }

  /** The event as it will be stored: times in order, a place that fits the format. */
  private async checked(
    tenantId: string,
    e: {
      title: string; kind: string; format: string; date: string; startTime: string; endTime: string | null;
      roomId: string | null; location: string | null; meetingUrl: string | null; audience: string; description: string | null;
    },
  ) {
    const title = e.title.trim();
    if (title.length < 2) throw new BadRequestException('Tadbir nomini yozing');
    if (Number.isNaN(dayNumber(e.date))) throw new BadRequestException('Sana noto\'g\'ri');
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
      const [room] = await this.db.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.tenantId, tenantId)));
      if (!room) throw new BadRequestException('Xona topilmadi');
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
