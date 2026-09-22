import { describe, it, expect, vi } from 'vitest';
import { isOverlapping, ScheduleService } from './schedule.service';

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
});
