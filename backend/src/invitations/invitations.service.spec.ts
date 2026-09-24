import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import bcrypt from 'bcryptjs';

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
      mockDb.query.invitations.findFirst.mockResolvedValue(null);
      const res = await service.create('tenant-1', 'user-1', {
        role: 'TEACHER',
        email: 'teacher@test.uz',
      });
      expect(res.inviteUrl).toBeDefined();
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('validateToken', () => {
    it('throws NotFoundException if invitation not found', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue(null);
      await expect(service.validateToken('invalid')).rejects.toThrow(NotFoundException);
    });

    it('rejects expired invitation', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-1',
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1000),
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

    it('validates token without leaking user identity (no user enumeration)', async () => {
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
      expect(res.tenantName).toBe('Oxford Center');
      expect(res.role).toBe('TEACHER');
      // No existingUser or existingUserName leaked publicly
      expect((res as any).existingUser).toBeUndefined();
      expect((res as any).existingUserName).toBeUndefined();
    });
  });

  describe('accept (Security & Test E / Test A)', () => {
    it('Test E: rejects unauthenticated existing user without password', async () => {
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
        passwordHash: await bcrypt.hash('correctPassword123', 10),
      });

      // No authenticatedUserId and no password
      await expect(service.accept('token', {}, undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('Test E: rejects unauthenticated existing user with incorrect password', async () => {
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
        passwordHash: await bcrypt.hash('correctPassword123', 10),
      });

      await expect(
        service.accept('token', { password: 'wrongPassword' }, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('Test E: rejects if session belongs to a DIFFERENT user than the invited identity', async () => {
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
        passwordHash: await bcrypt.hash('correctPassword123', 10),
      });

      // Logged in as attacker/other-user
      await expect(
        service.accept('token', {}, 'attacker-user-id'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('Test E: accepts existing user with valid password and creates organization membership', async () => {
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
        passwordHash: await bcrypt.hash('correctPassword123', 10),
      });
      mockDb.query.organizationMemberships.findFirst.mockResolvedValue(null);
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'tenant-2', name: 'Oxford Center', subdomain: 'oxford' });

      const res = await service.accept('token', { password: 'correctPassword123' }, undefined);
      expect(res.accessToken).toBe('mock-access-token');
      expect(res.user.fullName).toBe('Anvar Aliyev');
      expect(res.redirectUrl).toBe('/dashboard');
      expect(mockDb.insert).toHaveBeenCalled(); // inserted organization membership
    });

    it('Test E: accepts existing user with active matching session without asking password', async () => {
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

      const res = await service.accept('token', {}, 'user-anvar');
      expect(res.accessToken).toBe('mock-access-token');
      expect(res.user.id).toBe('user-anvar');
    });

    it('Test A: Parent invitation creates PARENT membership and redirects to /portal without creating an organization', async () => {
      mockDb.query.invitations.findFirst.mockResolvedValue({
        id: 'inv-parent-1',
        role: 'PARENT',
        email: 'parent@test.uz',
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 100000),
        tenantId: 'tenant-2',
      });
      mockDb.query.users.findFirst.mockResolvedValue(null); // new user
      mockDb.insert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{
            id: 'new-parent-user-id',
            fullName: 'Ota-ona Dilnoza',
            email: 'parent@test.uz',
            role: 'PARENT',
            tenantId: 'tenant-2',
          }]),
        }),
      });
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'tenant-2', name: 'Oxford Center', subdomain: 'oxford' });

      const res = await service.accept('token', {
        fullName: 'Ota-ona Dilnoza',
        password: 'password123',
      });

      expect(res.user.role).toBe('PARENT');
      expect(res.redirectUrl).toBe('/portal');
      // Verify no organization/tenant was created
      expect(mockDb.insert).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'tenants' }));
    });
  });
});
