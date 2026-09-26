import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, ne, isNull } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { groups, rooms, schedules, teachers } from '../db/schema';
import { CreateRoomDto, UpdateRoomDto } from './dto/room.dto';
import { CheckConflictDto, CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';

export interface ScheduleConflict {
  type: 'ROOM' | 'TEACHER' | 'GROUP';
  message: string;
  conflictingScheduleId: string;
  groupName?: string;
  roomName?: string;
  teacherName?: string;
  startTime: string;
  endTime: string;
  dayOfWeek?: number | null;
  date?: string | null;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function isOverlapping(startA: string, endA: string, startB: string, endB: string): boolean {
  const aStart = timeToMinutes(startA);
  const aEnd = timeToMinutes(endA);
  const bStart = timeToMinutes(startB);
  const bEnd = timeToMinutes(endB);
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

// ISO weekday (1 = Monday … 7 = Sunday) of a "YYYY-MM-DD" calendar date.
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

// Whether two lessons can fall on the same day. A lesson with a `date` is a
// one-off on that date; otherwise it recurs weekly on `dayOfWeek`.
//  - one-off vs one-off: same date;
//  - anything involving a recurring lesson: same weekday, taking a one-off
//    lesson's weekday from its date.
export function occursOnSameDay(
  a: { dayOfWeek?: number | null; date?: string | null },
  b: { dayOfWeek?: number | null; date?: string | null },
): boolean {
  if (a.date && b.date) return a.date === b.date;
  const dowA = a.date ? isoWeekday(a.date) : a.dayOfWeek;
  const dowB = b.date ? isoWeekday(b.date) : b.dayOfWeek;
  return !!dowA && dowA === dowB;
}

@Injectable()
export class ScheduleService {
  constructor(@Inject(DB) private readonly db: Database) {}

  // ==================== ROOMS CRUD ====================

  async findAllRooms(tenantId: string) {
    return this.db.query.rooms.findMany({
      where: eq(rooms.tenantId, tenantId),
      with: { branch: true },
      orderBy: (r, { asc }) => asc(r.name),
    });
  }

  async findOneRoom(tenantId: string, id: string) {
    const room = await this.db.query.rooms.findFirst({
      where: and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)),
      with: { branch: true },
    });
    if (!room) throw new NotFoundException('Xona topilmadi');
    return room;
  }

  async createRoom(tenantId: string, dto: CreateRoomDto) {
    const [room] = await this.db
      .insert(rooms)
      .values({
        tenantId,
        name: dto.name,
        branchId: dto.branchId || null,
        capacity: dto.capacity ?? 20,
        color: dto.color ?? '#4F46E5',
      })
      .returning();
    return room;
  }

  async updateRoom(tenantId: string, id: string, dto: UpdateRoomDto) {
    await this.findOneRoom(tenantId, id);
    const [updated] = await this.db
      .update(rooms)
      .set({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
        ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)))
      .returning();
    return updated;
  }

  async deleteRoom(tenantId: string, id: string) {
    await this.findOneRoom(tenantId, id);
    await this.db.delete(rooms).where(and(eq(rooms.id, id), eq(rooms.tenantId, tenantId)));
    return { success: true };
  }

  // ==================== CONFLICT ENGINE ====================

  async findConflicts(
    tenantId: string,
    params: {
      groupId: string;
      teacherId?: string | null;
      roomId?: string | null;
      dayOfWeek?: number | null;
      date?: string | null;
      startTime: string;
      endTime: string;
      excludeScheduleId?: string;
    },
  ): Promise<ScheduleConflict[]> {
    const { groupId, teacherId, roomId, dayOfWeek, date, startTime, endTime, excludeScheduleId } = params;

    // Fetch active candidates for this tenant
    const candidates = await this.db.query.schedules.findMany({
      where: and(
        eq(schedules.tenantId, tenantId),
        ne(schedules.status, 'CANCELLED'),
      ),
      with: {
        group: true,
        teacher: true,
        room: true,
      },
    });

    const conflicts: ScheduleConflict[] = [];

    for (const c of candidates) {
      if (excludeScheduleId && c.id === excludeScheduleId) continue;

      if (!occursOnSameDay({ dayOfWeek, date }, c)) continue;

      // Check time overlap
      if (!isOverlapping(startTime, endTime, c.startTime, c.endTime)) continue;

      // 1. Room collision
      if (roomId && c.roomId === roomId) {
        conflicts.push({
          type: 'ROOM',
          message: `"${c.room?.name || 'Xona'}" bu vaqtda band: ${c.group?.name || 'Boshqa guruh'} (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          roomName: c.room?.name,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }

      // 2. Teacher collision
      if (teacherId && c.teacherId === teacherId) {
        conflicts.push({
          type: 'TEACHER',
          message: `"${c.teacher?.fullName || "O'qituvchi"}" bu vaqtda boshqa darsda: ${c.group?.name || 'Guruh'} (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          teacherName: c.teacher?.fullName,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }

      // 3. Group collision
      if (groupId && c.groupId === groupId) {
        conflicts.push({
          type: 'GROUP',
          message: `"${c.group?.name || 'Guruh'}" uchun bu vaqtda boshqa dars belgilangan (${c.startTime} - ${c.endTime})`,
          conflictingScheduleId: c.id,
          groupName: c.group?.name,
          startTime: c.startTime,
          endTime: c.endTime,
          dayOfWeek: c.dayOfWeek,
          date: c.date,
        });
      }
    }

    return conflicts;
  }

  async checkConflicts(tenantId: string, dto: CheckConflictDto): Promise<{ hasConflict: boolean; conflicts: ScheduleConflict[] }> {
    const conflicts = await this.findConflicts(tenantId, {
      groupId: dto.groupId,
      teacherId: dto.teacherId,
      roomId: dto.roomId,
      dayOfWeek: dto.dayOfWeek,
      date: dto.date,
      startTime: dto.startTime,
      endTime: dto.endTime,
      excludeScheduleId: dto.excludeScheduleId,
    });
    return { hasConflict: conflicts.length > 0, conflicts };
  }

  // ==================== SCHEDULES CRUD ====================

  async findAllSchedules(
    tenantId: string,
    filters?: {
      branchId?: string;
      groupId?: string;
      teacherId?: string;
      roomId?: string;
      dayOfWeek?: number;
    },
  ) {
    const all = await this.db.query.schedules.findMany({
      where: eq(schedules.tenantId, tenantId),
      with: {
        group: true,
        teacher: true,
        room: true,
        branch: true,
      },
      orderBy: (s, { asc }) => [asc(s.dayOfWeek), asc(s.startTime)],
    });

    return all.filter((s) => {
      // Lessons of deleted groups stay stored (for restore) but are hidden.
      if (s.group?.deletedAt) return false;
      if (filters?.branchId && s.branchId !== filters.branchId) return false;
      if (filters?.groupId && s.groupId !== filters.groupId) return false;
      if (filters?.teacherId && s.teacherId !== filters.teacherId) return false;
      if (filters?.roomId && s.roomId !== filters.roomId) return false;
      if (filters?.dayOfWeek && s.dayOfWeek !== filters.dayOfWeek) return false;
      return true;
    });
  }

  async findOneSchedule(tenantId: string, id: string) {
    const item = await this.db.query.schedules.findFirst({
      where: and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)),
      with: {
        group: true,
        teacher: true,
        room: true,
        branch: true,
      },
    });
    if (!item) throw new NotFoundException('Dars jadvali topilmadi');
    return item;
  }

  async createSchedule(tenantId: string, dto: CreateScheduleDto) {
    // 1. Verify group exists and belongs to tenant
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
    });
    if (!group) throw new NotFoundException('Guruh topilmadi');

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    if (dto.roomId) {
      const room = await this.db.query.rooms.findFirst({
        where: and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)),
      });
      if (!room) throw new NotFoundException('Xona topilmadi');
    }

    const teacherId = dto.teacherId || group.teacherId || null;
    const branchId = dto.branchId || group.branchId || null;

    // 2. Collision detection
    if (!dto.allowCollision) {
      const conflicts = await this.findConflicts(tenantId, {
        groupId: dto.groupId,
        teacherId,
        roomId: dto.roomId || null,
        dayOfWeek: dto.dayOfWeek,
        date: dto.date,
        startTime: dto.startTime,
        endTime: dto.endTime,
      });

      if (conflicts.length > 0) {
        throw new ConflictException({
          message: 'Dars jadvalida to\'qnashuv aniqlandi',
          conflicts,
        });
      }
    }

    const [created] = await this.db
      .insert(schedules)
      .values({
        tenantId,
        groupId: dto.groupId,
        teacherId,
        roomId: dto.roomId || null,
        branchId,
        dayOfWeek: dto.dayOfWeek || null,
        date: dto.date || null,
        startTime: dto.startTime,
        endTime: dto.endTime,
        isRecurring: dto.isRecurring ?? true,
        onlineMeetingUrl: dto.onlineMeetingUrl || null,
        status: dto.status ?? 'SCHEDULED',
        topic: dto.topic || null,
      })
      .returning();

    return this.findOneSchedule(tenantId, created.id);
  }

  async updateSchedule(tenantId: string, id: string, dto: UpdateScheduleDto) {
    const current = await this.findOneSchedule(tenantId, id);

    if (dto.groupId) {
      const group = await this.db.query.groups.findFirst({
        where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId), isNull(groups.deletedAt)),
      });
      if (!group) throw new NotFoundException('Guruh topilmadi');
    }

    if (dto.teacherId) {
      const teacher = await this.db.query.teachers.findFirst({
        where: and(eq(teachers.id, dto.teacherId), eq(teachers.tenantId, tenantId), isNull(teachers.deletedAt)),
      });
      if (!teacher) throw new NotFoundException("O'qituvchi topilmadi");
    }

    if (dto.roomId) {
      const room = await this.db.query.rooms.findFirst({
        where: and(eq(rooms.id, dto.roomId), eq(rooms.tenantId, tenantId)),
      });
      if (!room) throw new NotFoundException('Xona topilmadi');
    }

    const groupId = dto.groupId ?? current.groupId;
    const teacherId = dto.teacherId !== undefined ? dto.teacherId : current.teacherId;
    const roomId = dto.roomId !== undefined ? dto.roomId : current.roomId;
    const dayOfWeek = dto.dayOfWeek !== undefined ? dto.dayOfWeek : current.dayOfWeek;
    const date = dto.date !== undefined ? dto.date : current.date;
    const startTime = dto.startTime ?? current.startTime;
    const endTime = dto.endTime ?? current.endTime;

    if (!dto.allowCollision) {
      const conflicts = await this.findConflicts(tenantId, {
        groupId,
        teacherId,
        roomId,
        dayOfWeek,
        date,
        startTime,
        endTime,
        excludeScheduleId: id,
      });

      if (conflicts.length > 0) {
        throw new ConflictException({
          message: 'Dars jadvalida to\'qnashuv aniqlandi',
          conflicts,
        });
      }
    }

    await this.db
      .update(schedules)
      .set({
        ...(dto.groupId !== undefined ? { groupId: dto.groupId } : {}),
        ...(dto.teacherId !== undefined ? { teacherId: dto.teacherId || null } : {}),
        ...(dto.roomId !== undefined ? { roomId: dto.roomId || null } : {}),
        ...(dto.branchId !== undefined ? { branchId: dto.branchId || null } : {}),
        ...(dto.dayOfWeek !== undefined ? { dayOfWeek: dto.dayOfWeek || null } : {}),
        ...(dto.date !== undefined ? { date: dto.date || null } : {}),
        ...(dto.startTime !== undefined ? { startTime: dto.startTime } : {}),
        ...(dto.endTime !== undefined ? { endTime: dto.endTime } : {}),
        ...(dto.isRecurring !== undefined ? { isRecurring: dto.isRecurring } : {}),
        ...(dto.onlineMeetingUrl !== undefined ? { onlineMeetingUrl: dto.onlineMeetingUrl || null } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.topic !== undefined ? { topic: dto.topic || null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));

    return this.findOneSchedule(tenantId, id);
  }

  async deleteSchedule(tenantId: string, id: string) {
    await this.findOneSchedule(tenantId, id);
    await this.db.delete(schedules).where(and(eq(schedules.id, id), eq(schedules.tenantId, tenantId)));
    return { success: true };
  }
}
