import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TeachersService } from './teachers.service';

describe('TeachersService', () => {
  let service: TeachersService;
  let mockDb: any;
  let mockAudit: any;

  beforeEach(() => {
    mockDb = {
      query: {
        teachers: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn(),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn(),
          }),
        }),
      }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new TeachersService(mockDb, mockAudit);
  });

  describe('findAll', () => {
    it('returns all active teachers for tenant', async () => {
      const mockTeachers = [
        { id: 't-1', fullName: 'Aziz Ustoz', tenantId: 'tenant-1' },
      ];
      mockDb.query.teachers.findMany.mockResolvedValue(mockTeachers);

      const result = await service.findAll('tenant-1');
      expect(result).toEqual(mockTeachers);
      expect(mockDb.query.teachers.findMany).toHaveBeenCalled();
    });
  });

  describe('trash', () => {
    it('returns soft-deleted teachers', async () => {
      const deletedTeachers = [{ id: 't-del', fullName: 'Ochirilgan', deletedAt: new Date() }];
      mockDb.query.teachers.findMany.mockResolvedValue(deletedTeachers);

      const result = await service.trash('tenant-1');
      expect(result).toEqual(deletedTeachers);
    });
  });

  describe('findOne', () => {
    it('returns teacher if found', async () => {
      const teacher = { id: 't-1', fullName: 'Aziz Ustoz', tenantId: 'tenant-1' };
      mockDb.query.teachers.findFirst.mockResolvedValue(teacher);

      const result = await service.findOne('tenant-1', 't-1');
      expect(result).toEqual(teacher);
    });

    it('throws NotFoundException if teacher not found', async () => {
      mockDb.query.teachers.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('creates teacher and writes audit log', async () => {
      const newTeacher = { id: 't-new', fullName: 'Dilshod', phone: '+998901234567' };
      mockDb.insert().values().returning.mockResolvedValue([newTeacher]);

      const result = await service.create('tenant-1', 'user-1', {
        fullName: 'Dilshod',
        phone: '+998901234567',
        subject: 'Matematika',
      });

      expect(result).toEqual(newTeacher);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'create',
        entityType: 'teacher',
        entityId: 't-new',
      }));
    });
  });

  describe('update', () => {
    it('updates teacher and writes audit log', async () => {
      const existing = { id: 't-1', fullName: 'Eski Ustoz', tenantId: 'tenant-1' };
      const updated = { id: 't-1', fullName: 'Yangi Ustoz', tenantId: 'tenant-1' };
      mockDb.query.teachers.findFirst.mockResolvedValue(existing);
      mockDb.update().set().where().returning.mockResolvedValue([updated]);

      const result = await service.update('tenant-1', 'user-1', 't-1', {
        fullName: 'Yangi Ustoz',
      });

      expect(result).toEqual(updated);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'update',
        entityType: 'teacher',
        entityId: 't-1',
      }));
    });
  });

  describe('remove & restore', () => {
    it('soft deletes teacher', async () => {
      const teacher = { id: 't-1', tenantId: 'tenant-1' };
      mockDb.query.teachers.findFirst.mockResolvedValue(teacher);
      mockDb.update().set().where.mockResolvedValue({});

      const result = await service.remove('tenant-1', 'user-1', 't-1');
      expect(result).toEqual({ success: true });
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete',
        entityType: 'teacher',
        entityId: 't-1',
      }));
    });

    it('restores soft-deleted teacher', async () => {
      const teacher = { id: 't-1', tenantId: 'tenant-1', deletedAt: null };
      mockDb.update().set().where().returning.mockResolvedValue([teacher]);

      const result = await service.restore('tenant-1', 'user-1', 't-1');
      expect(result).toEqual(teacher);
      expect(mockAudit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'restore',
        entityType: 'teacher',
        entityId: 't-1',
      }));
    });

    it('throws NotFoundException on restore if teacher not found', async () => {
      mockDb.update().set().where().returning.mockResolvedValue([]);

      await expect(service.restore('tenant-1', 'user-1', 'nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
