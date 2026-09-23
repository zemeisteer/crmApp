import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';

describe('OnboardingService', () => {
  let service: OnboardingService;
  let mockDb: any;

  beforeEach(() => {
    mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn(),
        },
      },
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ val: 0 }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'tenant-1' }]),
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'branch-1' }]),
        }),
      }),
    };
    service = new OnboardingService(mockDb);
  });

  describe('checkSubdomain', () => {
    it('rejects subdomains shorter than 3 characters', async () => {
      const result = await service.checkSubdomain('tenant-1', 'ab');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('3 tadan 40 tagacha');
    });

    it('rejects invalid characters (spaces, special chars)', async () => {
      const result = await service.checkSubdomain('tenant-1', 'my center!');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('Faqat kichik lotin');
    });

    it('rejects reserved subdomains like admin, api, billing', async () => {
      const result1 = await service.checkSubdomain('tenant-1', 'admin');
      expect(result1.available).toBe(false);
      expect(result1.reason).toContain('band qilingan');

      const result2 = await service.checkSubdomain('tenant-1', 'api');
      expect(result2.available).toBe(false);

      const result3 = await service.checkSubdomain('tenant-1', 'billing');
      expect(result3.available).toBe(false);
    });

    it('rejects collision with existing tenant subdomain', async () => {
      mockDb.query.tenants.findFirst.mockResolvedValue({ id: 'other-tenant', subdomain: 'bilimdon' });
      const result = await service.checkSubdomain('tenant-1', 'bilimdon');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('allaqachon band');
    });

    it('accepts valid and available subdomain', async () => {
      mockDb.query.tenants.findFirst.mockResolvedValue(null);
      const result = await service.checkSubdomain('tenant-1', 'bilimdon-academy');
      expect(result.available).toBe(true);
      expect(result.slug).toBe('bilimdon-academy');
    });
  });

  describe('updateWorkspace', () => {
    it('throws BadRequestException if subdomain is reserved or taken', async () => {
      await expect(
        service.updateWorkspace('tenant-1', { subdomain: 'admin' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates tenant subdomain and advances step to BRANCH', async () => {
      mockDb.query.tenants.findFirst.mockResolvedValue(null);
      mockDb.update().set().where().returning.mockResolvedValue([
        { id: 'tenant-1', subdomain: 'oxford-center', onboardingStep: 'BRANCH' },
      ]);

      const res = await service.updateWorkspace('tenant-1', { subdomain: 'oxford-center' });
      expect(res.success).toBe(true);
      expect(res.nextStep).toBe('BRANCH');
    });
  });
});
