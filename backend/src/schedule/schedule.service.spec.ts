import { describe, it, expect, vi } from 'vitest';
import { isOverlapping, isoWeekday, occursOnSameDay, ScheduleService } from './schedule.service';

describe('ScheduleService', () => {
  describe('isOverlapping helper', () => {
    it('detects overlapping time ranges', () => {
      // 09:00 - 10:30 and 10:00 - 11:30 overlap
      expect(isOverlapping('09:00', '10:30', '10:00', '11:30')).toBe(true);
      // Contained inside
      expect(isOverlapping('09:00', '12:00', '10:00', '11:00')).toBe(true);
      expect(isOverlapping('10:00', '11:00', '09:00', '12:00')).toBe(true);
    });

    it('returns false for adjacent/non-overlapping time ranges', () => {
      // 09:00 - 10:30 ends exactly when 10:30 - 12:00 starts
      expect(isOverlapping('09:00', '10:30', '10:30', '12:00')).toBe(false);
      // Completely separate
      expect(isOverlapping('09:00', '10:00', '14:00', '15:30')).toBe(false);
    });
  });

  describe('findConflicts', () => {
    const mockDb = {
      query: {
        schedules: {
          findMany: vi.fn(),
        },
      },
    };

    const service = new ScheduleService(mockDb as any);

    it('detects room and teacher collisions on the same day and overlapping time', async () => {
      mockDb.query.schedules.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          teacherId: 'teacher-1',
          roomId: 'room-101',
          dayOfWeek: 1, // Monday
          startTime: '09:00',
          endTime: '10:30',
          status: 'SCHEDULED',
          room: { name: '101-xona' },
          teacher: { fullName: 'Ali Valiyev' },
          group: { name: 'IELTS Band 7' },
        },
      ]);

      const conflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-2',
        teacherId: 'teacher-1', // Same teacher!
        roomId: 'room-101',    // Same room!
        dayOfWeek: 1,          // Monday!
        startTime: '10:00',    // Overlaps 09:00 - 10:30!
        endTime: '11:30',
      });

      expect(conflicts).toHaveLength(2);
      expect(conflicts.some((c) => c.type === 'ROOM')).toBe(true);
      expect(conflicts.some((c) => c.type === 'TEACHER')).toBe(true);
    });

    it('ignores collision if on a different day or non-overlapping time', async () => {
      mockDb.query.schedules.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          teacherId: 'teacher-1',
          roomId: 'room-101',
          dayOfWeek: 1, // Monday
          startTime: '09:00',
          endTime: '10:30',
          status: 'SCHEDULED',
        },
      ]);

      // Different day (Tuesday = 2)
      const diffDayConflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-2',
        teacherId: 'teacher-1',
        roomId: 'room-101',
        dayOfWeek: 2,
        startTime: '09:00',
        endTime: '10:30',
      });
      expect(diffDayConflicts).toHaveLength(0);

      // Same day, but after previous lesson (10:30 - 12:00)
      const nonOverlappingConflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-2',
        teacherId: 'teacher-1',
        roomId: 'room-101',
        dayOfWeek: 1,
        startTime: '10:30',
        endTime: '12:00',
      });
      expect(nonOverlappingConflicts).toHaveLength(0);
    });

    it('excludes the schedule being updated when excludeScheduleId is provided', async () => {
      mockDb.query.schedules.findMany.mockResolvedValue([
        {
          id: 'sched-1',
          tenantId: 'tenant-1',
          groupId: 'group-1',
          teacherId: 'teacher-1',
          roomId: 'room-101',
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '10:30',
          status: 'SCHEDULED',
        },
      ]);

      const conflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-1',
        teacherId: 'teacher-1',
        roomId: 'room-101',
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '10:30',
        excludeScheduleId: 'sched-1',
      });
      expect(conflicts).toHaveLength(0);
    });
  });

  describe('day alignment', () => {
    // 2026-10-05 is a Monday.
    it('computes ISO weekdays from calendar dates', () => {
      expect(isoWeekday('2026-10-05')).toBe(1);
      expect(isoWeekday('2026-10-11')).toBe(7);
    });

    it('matches a one-off lesson against a weekly lesson only on its weekday', () => {
      expect(occursOnSameDay({ dayOfWeek: 1 }, { date: '2026-10-05' })).toBe(true);
      // Regression: any one-off lesson used to clash with every weekly slot.
      expect(occursOnSameDay({ dayOfWeek: 1 }, { date: '2026-10-06' })).toBe(false);
      // Regression: a dated lesson was never checked against weekly lessons.
      expect(occursOnSameDay({ date: '2026-10-05' }, { dayOfWeek: 1 })).toBe(true);
    });

    it('compares one-off lessons by date and weekly lessons by weekday', () => {
      expect(occursOnSameDay({ date: '2026-10-05' }, { date: '2026-10-12' })).toBe(false);
      expect(occursOnSameDay({ date: '2026-10-05' }, { date: '2026-10-05' })).toBe(true);
      expect(occursOnSameDay({ dayOfWeek: 3 }, { dayOfWeek: 3 })).toBe(true);
      expect(occursOnSameDay({ dayOfWeek: 3 }, { dayOfWeek: 4 })).toBe(false);
    });
  });

  describe('findConflicts with one-off lessons', () => {
    const lesson = (over: Record<string, unknown>) => ({
      id: 'sched-x', tenantId: 'tenant-1', groupId: 'group-9', teacherId: 'teacher-1', roomId: null,
      startTime: '09:00', endTime: '10:30', status: 'SCHEDULED',
      teacher: { fullName: 'Ali Valiyev' }, group: { name: 'G9' }, room: null, ...over,
    });

    it('ignores a one-off lesson on a different weekday than the new weekly slot', async () => {
      const db = { query: { schedules: { findMany: vi.fn().mockResolvedValue([lesson({ dayOfWeek: null, date: '2026-10-06' })]) } } };
      const service = new ScheduleService(db as any);
      const conflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-1', teacherId: 'teacher-1', dayOfWeek: 1, startTime: '09:30', endTime: '10:00',
      });
      expect(conflicts).toHaveLength(0);
    });

    it('flags a new one-off lesson that falls on a weekly lesson of the same teacher', async () => {
      const db = { query: { schedules: { findMany: vi.fn().mockResolvedValue([lesson({ dayOfWeek: 1, date: null })]) } } };
      const service = new ScheduleService(db as any);
      const conflicts = await service.findConflicts('tenant-1', {
        groupId: 'group-1', teacherId: 'teacher-1', date: '2026-10-05', startTime: '09:30', endTime: '10:00',
      });
      expect(conflicts.map((c) => c.type)).toEqual(['TEACHER']);
    });
  });
});
