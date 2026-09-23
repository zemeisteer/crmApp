import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { LeadsService } from './leads.service';

describe('LeadsService', () => {
  let service: LeadsService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: {
        leads: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        branches: {
          findFirst: vi.fn(),
        },
        groups: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        students: {
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

    service = new LeadsService(mockDb);
  });

  describe('findAll', () => {
    it('returns filtered leads list for tenant', async () => {
      const mockLeads = [
        { id: 'lead-1', fullName: 'Shaxzod Aliyev', status: 'NEW', tenantId: 'tenant-1' },
      ];
      mockDb.query.leads.findMany.mockResolvedValue(mockLeads);

      const result = await service.findAll('tenant-1', { status: 'NEW', search: 'Shaxzod' });
      expect(result).toEqual(mockLeads);
      expect(mockDb.query.leads.findMany).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns lead if found', async () => {
      const lead = { id: 'lead-1', fullName: 'Shaxzod Aliyev', tenantId: 'tenant-1' };
      mockDb.query.leads.findFirst.mockResolvedValue(lead);

      const result = await service.findOne('tenant-1', 'lead-1');
      expect(result).toEqual(lead);
    });

    it('throws NotFoundException when lead is not found', async () => {
      mockDb.query.leads.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'invalid-lead')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getFunnelStats', () => {
    it('calculates counts, conversion rate and source distribution', async () => {
      const allLeads = [
        { id: '1', status: 'NEW', source: 'INSTAGRAM' },
        { id: '2', status: 'ENROLLED', source: 'INSTAGRAM' },
        { id: '3', status: 'LOST', source: 'TELEGRAM' },
      ];
      mockDb.query.leads.findMany.mockResolvedValue(allLeads);

      const stats = await service.getFunnelStats('tenant-1');
      expect(stats.total).toBe(3);
      expect(stats.counts.NEW).toBe(1);
      expect(stats.counts.ENROLLED).toBe(1);
      expect(stats.counts.LOST).toBe(1);
      expect(stats.conversionRate).toBe(33);
      expect(stats.bySource.INSTAGRAM.total).toBe(2);
      expect(stats.bySource.INSTAGRAM.enrolled).toBe(1);
      expect(stats.bySource.INSTAGRAM.conversionRate).toBe(50);
    });
  });

  describe('create', () => {
    it('creates a new lead with basic fields', async () => {
      const createdLead = { id: 'lead-1', fullName: 'Rustam', phone: '+998901112233', status: 'NEW' };
      mockDb.insert().values().returning.mockResolvedValue([createdLead]);

      const result = await service.create('tenant-1', {
        fullName: 'Rustam',
        phone: '+998901112233',
      });

      expect(result).toEqual(createdLead);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('throws BadRequestException if branch does not exist', async () => {
      mockDb.query.branches.findFirst.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', {
          fullName: 'Rustam',
          phone: '+998901112233',
          branchId: 'invalid-branch',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if trial group does not exist', async () => {
      mockDb.query.groups.findFirst.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', {
          fullName: 'Rustam',
          phone: '+998901112233',
          trialGroupId: 'invalid-group',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update', () => {
    it('updates lead fields successfully', async () => {
      const existing = { id: 'lead-1', fullName: 'Rustam', tenantId: 'tenant-1' };
      const updated = { ...existing, status: 'QUALIFIED' };
      mockDb.query.leads.findFirst.mockResolvedValue(existing);
      mockDb.update().set().where().returning.mockResolvedValue([updated]);

      const result = await service.update('tenant-1', 'lead-1', { status: 'QUALIFIED' });
      expect(result).toEqual(updated);
    });
  });

  describe('convert', () => {
    it('converts lead into a student and marks lead as ENROLLED', async () => {
      const lead = {
        id: 'lead-1',
        fullName: 'Rustam Bek',
        phone: '+998901112233',
        parentPhone: '+998902223344',
        tenantId: 'tenant-1',
        convertedStudentId: null,
      };
      const createdStudent = { id: 'student-100', fullName: lead.fullName };
      const updatedLead = { ...lead, status: 'ENROLLED', convertedStudentId: 'student-100' };

      mockDb.query.leads.findFirst.mockResolvedValue(lead);
      mockDb.query.groups.findMany.mockResolvedValue([{ id: 'grp-1', tenantId: 'tenant-1' }]);
      mockDb.insert().values().returning.mockResolvedValue([createdStudent]);
      mockDb.update().set().where().returning.mockResolvedValue([updatedLead]);

      const result = await service.convert('tenant-1', 'lead-1', {
        groupIds: ['grp-1'],
        gender: 'MALE',
      });

      expect(result.student).toEqual(createdStudent);
      expect(result.lead).toEqual(updatedLead);
    });

    it('returns existing student if lead was already converted', async () => {
      const existingStudent = { id: 'student-already', fullName: 'Rustam Bek' };
      const lead = {
        id: 'lead-1',
        tenantId: 'tenant-1',
        convertedStudentId: 'student-already',
      };

      mockDb.query.leads.findFirst.mockResolvedValue(lead);
      mockDb.query.students.findFirst.mockResolvedValue(existingStudent);

      const result = await service.convert('tenant-1', 'lead-1', {});
      expect(result.student).toEqual(existingStudent);
    });
  });

  describe('remove', () => {
    it('removes lead by id', async () => {
      const lead = { id: 'lead-1', tenantId: 'tenant-1' };
      mockDb.query.leads.findFirst.mockResolvedValue(lead);

      const result = await service.remove('tenant-1', 'lead-1');
      expect(result).toEqual({ success: true });
      expect(mockDb.delete).toHaveBeenCalled();
    });
  });
});
