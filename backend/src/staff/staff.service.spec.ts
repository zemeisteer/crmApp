import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { StaffService } from './staff.service';

describe('StaffService', () => {
  let service: StaffService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: {
        users: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        organizationMemberships: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id', role: 'TEACHER' }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'mock-id', role: 'MANAGER' }]),
          }),
        }),
      }),
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
      }),
    };

    service = new StaffService(mockDb);
  });

  describe('findAll', () => {
    it('returns staff memberships for the given tenant with user details', async () => {
      mockDb.query.organizationMemberships.findMany.mockResolvedValue([
        {
          id: 'mem-1',
          userId: 'user-1',
          tenantId: 'tenant-1',
          role: 'ADMIN',
          status: 'ACTIVE',
          permissions: ['*'],
          createdAt: new Date(),
          user: { id: 'user-1', email: 'admin@crmapp.uz', fullName: 'Ali Admin', createdAt: new Date() },
        },
      ]);

      const res = await service.findAll('tenant-1');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('user-1');
      expect(res[0].membershipId).toBe('mem-1');
      expect(res[0].email).toBe('admin@crmapp.uz');
      expect(res[0].role).toBe('ADMIN');
    });
  });

  describe('create', () => {
    it('creates new user and active membership if user does not exist', async () => {
      mockDb.query.users.findFirst.mockResolvedValue(null);
      mockDb.insert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'user-new', email: 'new@test.uz', fullName: 'Vali Ustoz', role: 'TEACHER' },
          ]),
        }),
      }).mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'mem-new', role: 'TEACHER', permissions: [], createdAt: new Date() },
          ]),
        }),
      });

      const res = await service.create('tenant-1', {
        fullName: 'Vali Ustoz',
        email: 'new@test.uz',
        password: 'password123',
        role: 'TEACHER',
      });

      expect(res.id).toBe('user-new');
      expect(res.email).toBe('new@test.uz');
      expect(mockDb.insert).toHaveBeenCalledTimes(2); // user + membership
    });

    it('attaches existing user to organization without duplicate user creation', async () => {
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-existing',
        email: 'existing@test.uz',
        fullName: 'Existing User',
      });
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue(null);
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            { id: 'mem-2', role: 'MANAGER', permissions: [], createdAt: new Date() },
          ]),
        }),
      });

      const res = await service.create('tenant-1', {
        fullName: 'Existing User',
        email: 'existing@test.uz',
        password: 'ignored-password',
        role: 'MANAGER',
      });

      expect(res.id).toBe('user-existing');
      expect(mockDb.insert).toHaveBeenCalledTimes(1); // Only organization_memberships!
    });
  });

  describe('remove', () => {
    it('throws error if user tries to remove themselves', async () => {
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue({
        id: 'mem-1',
        userId: 'user-1',
        tenantId: 'tenant-1',
        role: 'ADMIN',
        status: 'ACTIVE',
      });

      await expect(service.remove('tenant-1', 'user-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('deletes ONLY organization_memberships and NEVER deletes global users', async () => {
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue({
        id: 'mem-target',
        userId: 'user-anvar',
        tenantId: 'tenant-a',
        role: 'TEACHER',
        status: 'ACTIVE',
      });

      const res = await service.remove('tenant-a', 'user-anvar', 'user-admin');

      expect(res.success).toBe(true);
      expect(mockDb.delete).toHaveBeenCalledTimes(1);
      // Ensure it deleted membership and did NOT call delete on users table
      expect(mockDb.query.users.findFirst).not.toHaveBeenCalled();
    });
  });
});
