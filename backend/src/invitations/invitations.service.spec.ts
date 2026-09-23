import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';

describe('InvitationsService', () => {
  let service: InvitationsService;
  let mockDb: any;
  let mockAuthService: any;

  beforeEach(() => {
    mockDb = {
      query: {
        invitations: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        tenants: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn(),
        },
        organizationMemberships: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'inv-1',
            status: 'PENDING',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'inv-1', status: 'REVOKED' }]),
          }),
        }),
      }),
    };

    mockAuthService = {
      issueFullSession: vi.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      }),
    };

    service = new InvitationsService(mockDb, mockAuthService);
  });

  describe('create', () => {
    it('requires either email or phone', async () => {
      await expect(
        service.create('tenant-1', 'user-1', { role: 'TEACHER' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates invitation with 7 days expiration', async () => {
      const res = await service.create('tenant-1', 'user-1', {
        role: 'TEACHER',
        email: 'teacher@test.uz',
      });

      expect(res.token).toBeDefined();
      expect(res.inviteUrl).toContain(res.token);
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    });
  });

  describe('validateToken', () => {
    it('throws NotFoundException if invitation not found', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue(null);
      await expect(service.validateToken('invalid-token')).rejects.toThrow(NotFoundException);
    });

    it('rejects expired invitation', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000), // expired
      });
      await expect(service.validateToken('token')).rejects.toThrow('muddati tugagan');
    });

    it('rejects already accepted invitation', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: 'ACCEPTED',
        expiresAt: new Date(Date.now() + 100000),
      });
      await expect(service.validateToken('token')).rejects.toThrow('allaqachon qabul qilingan');
    });

    it('identifies existing user by email', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        role: 'TEACHER',
        email: 'anvar@test.uz',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        tenantId: 'tenant-2',
      });
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'tenant-2', name: 'Oxford Center' });
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-anvar',
        fullName: 'Anvar Aliyev',
        email: 'anvar@test.uz',
      });

      const res = await service.validateToken('token');
      expect(res.valid).toBe(true);
      expect(res.existingUser).toBe(true);
      expect(res.existingUserName).toBe('Anvar Aliyev');
    });
  });

  describe('accept', () => {
    it('adds existing user to new organization without creating duplicate user', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        role: 'TEACHER',
        email: 'anvar@test.uz',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        tenantId: 'tenant-2',
      });
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-anvar',
        fullName: 'Anvar Aliyev',
        email: 'anvar@test.uz',
      });
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue(null);
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'tenant-2', name: 'Oxford Center', subdomain: 'oxford' });

      const res = await service.accept('token', {});
      expect(res.accessToken).toBe('mock-access-token');
      expect(res.user.fullName).toBe('Anvar Aliyev');
      expect(res.redirectUrl).toBe('/dashboard');
    });

    it('redirects student to /portal', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        role: 'STUDENT',
        email: 'student@test.uz',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        tenantId: 'tenant-2',
      });
      mockDb.query.users.findFirst.mockResolvedValue({
        id: 'user-student',
        fullName: 'Oquvchi Sardor',
        email: 'student@test.uz',
      });
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue(null);
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'tenant-2', name: 'Oxford Center', subdomain: 'oxford' });

      const res = await service.accept('token', {});
      expect(res.redirectUrl).toBe('/portal');
    });
  });
});
