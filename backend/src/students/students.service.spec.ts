import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { StudentsService } from './students.service';

describe('StudentsService', () => {
  let service: StudentsService;
  let mockDb: any;
  let mockAudit: any;
  let mockWebhooks: any;

  beforeEach(() => {
    mockDb = {
      query: {
        students: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        groups: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        enrollments: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn(),
          onConflictDoNothing: vi.fn().mockResolvedValue({}),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn(),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    mockWebhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };

    service = new StudentsService(mockDb, mockAudit, mockWebhooks);
  });

  describe('findAll', () => {
    it('returns all active students for tenant', async () => {
      const mockStudents = [
        { id: 'st-1', fullName: 'Ali Valiyev', tenantId: 'tenant-1' },
        { id: 'st-2', fullName: 'Olim Karimov', tenantId: 'tenant-1' },
      ];
      mockDb.query.students.findMany.mockResolvedValue(mockStudents);

      const result = await service.findAll('tenant-1');
      expect(result).toEqual(mockStudents);
      expect(mockDb.query.students.findMany).toHaveBeenCalled();
    });
  });

  describe('trash', () => {
    it('returns soft-deleted students for tenant', async () => {
      const mockDeleted = [{ id: 'st-deleted', fullName: 'Ochirilgan Talaba', deletedAt: new Date() }];
      mockDb.query.students.findMany.mockResolvedValue(mockDeleted);

      const result = await service.trash('tenant-1');
      expect(result).toEqual(mockDeleted);
    });
  });

  describe('findOne', () => {
    it('returns student if found', async () => {
      const student = { id: 'st-1', fullName: 'Ali Valiyev', tenantId: 'tenant-1' };
      mockDb.query.students.findFirst.mockResolvedValue(student);

      const result = await service.findOne('tenant-1', 'st-1');
      expect(result).toEqual(student);
    });

    it('throws NotFoundException when student not found', async () => {
      mockDb.query.students.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'invalid-id')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates a student without groups', async () => {
      const createdStudent = { id: 'st-new', fullName: 'Yangi Oquvchi', phone: '+998901234567' };
      mockDb.insert().values().returning.mockResolvedValue([createdStudent]);

      const result = await service.create('tenant-1', 'user-1', {
        fullName: 'Yangi Oquvchi',
        phone: '+998901234567',
      });

      expect(result).toEqual(createdStudent);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create',
        entityType: 'student',
        entityId: 'st-new',
      }));
      expect(mockWebhooks.dispatch).toHaveBeenCalledWith('tenant-1', 'student.created', createdStudent);
    });

    it('creates a student and links groups', async () => {
      const createdStudent = { id: 'st-new', fullName: 'Yangi Oquvchi' };
      mockDb.insert().values().returning.mockResolvedValue([createdStudent]);
      mockDb.query.groups.findMany.mockResolvedValue([{ id: 'grp-1' }]);

      const result = await service.create('tenant-1', 'user-1', {
        fullName: 'Yangi Oquvchi',
        groupIds: ['grp-1'],
      });

      expect(result).toEqual(createdStudent);
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates student fields and writes audit log', async () => {
      const existing = { id: 'st-1', fullName: 'Eski Ism', tenantId: 'tenant-1' };
      const updated = { id: 'st-1', fullName: 'Yangi Ism', tenantId: 'tenant-1' };
      mockDb.query.students.findFirst.mockResolvedValue(existing);
      mockDb.update().set().where().returning.mockResolvedValue([updated]);

      const result = await service.update('tenant-1', 'user-1', 'st-1', { fullName: 'Yangi Ism' });
      expect(result).toEqual(updated);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'update',
        entityType: 'student',
        entityId: 'st-1',
      }));
    });
  });

  describe('remove & restore', () => {
    it('soft deletes student by setting deletedAt', async () => {
      const student = { id: 'st-1', tenantId: 'tenant-1' };
      mockDb.query.students.findFirst.mockResolvedValue(student);
      mockDb.update().set().where.mockResolvedValue({});

      const result = await service.remove('tenant-1', 'user-1', 'st-1');
      expect(result).toEqual({ success: true });
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete',
        entityType: 'student',
        entityId: 'st-1',
      }));
    });

    it('restores soft-deleted student', async () => {
      const student = { id: 'st-1', tenantId: 'tenant-1', deletedAt: null };
      mockDb.update().set().where().returning.mockResolvedValue([student]);

      const result = await service.restore('tenant-1', 'user-1', 'st-1');
      expect(result).toEqual(student);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'restore',
        entityType: 'student',
        entityId: 'st-1',
      }));
    });

    it('throws NotFoundException on restore if student not found', async () => {
      mockDb.update().set().where().returning.mockResolvedValue([]);

      await expect(service.restore('tenant-1', 'user-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('enroll & unenroll', () => {
    it('enrolls student into group', async () => {
      mockDb.query.students.findFirst.mockResolvedValue({ id: 'st-1' });
      mockDb.query.groups.findFirst.mockResolvedValue({ id: 'grp-1' });
      mockDb.query.enrollments.findFirst.mockResolvedValue(null);
      mockDb.insert().values().returning.mockResolvedValue([{ id: 'enr-1', status: 'ACTIVE' }]);

      const result = await service.enroll('tenant-1', 'st-1', 'grp-1');
      expect(result.success).toBe(true);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('throws NotFoundException if group not found during enroll', async () => {
      mockDb.query.students.findFirst.mockResolvedValue({ id: 'st-1' });
      mockDb.query.groups.findFirst.mockResolvedValue(null);

      await expect(service.enroll('tenant-1', 'st-1', 'invalid-group')).rejects.toThrow(NotFoundException);
    });

    it('unenrolls student from group', async () => {
      mockDb.query.students.findFirst.mockResolvedValue({ id: 'st-1' });
      mockDb.query.enrollments.findFirst.mockResolvedValue({ id: 'enr-1', status: 'ACTIVE' });
      mockDb.update().set().where().returning.mockResolvedValue([{ id: 'enr-1', status: 'CANCELLED' }]);

      const result = await service.unenroll('tenant-1', 'st-1', 'grp-1');
      expect(result.success).toBe(true);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });
});
