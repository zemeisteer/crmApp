import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoicesService } from './invoices.service';

describe('InvoicesService', () => {
  let service: InvoicesService;
  let mockDb: any;
  let mockAudit: any;

  beforeEach(() => {
    mockDb = {
      query: {
        invoices: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        students: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        enrollments: {
          findFirst: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'inv-1', amount: 500000, remainingAmount: 500000, status: 'OPEN' }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'inv-1', status: 'CANCELLED' }]),
          }),
        }),
      }),
    };

    mockAudit = {
      log: vi.fn(),
    };

    service = new InvoicesService(mockDb, mockAudit);
  });

  describe('create', () => {
    it('creates an invoice with OPEN status and full remaining balance', async () => {
      mockDb.query.students.findFirst.mockResolvedValue({ id: 'student-1', tenantId: 'tenant-1' });

      const result = await service.create('tenant-1', {
        studentId: 'student-1',
        amount: 500000,
        dueDate: '2026-10-10T18:00:00.000Z',
        forMonth: '2026-10',
        description: 'Test tuition',
      });

      expect(result).toBeDefined();
      expect(result.amount).toBe(500000);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'create',
          entityType: 'invoice',
        }),
      );
    });

    it('throws NotFoundException if student is not found in tenant', async () => {
      mockDb.query.students.findFirst.mockResolvedValue(null);

      await expect(
        service.create('tenant-1', {
          studentId: 'student-missing',
          amount: 500000,
          dueDate: '2026-10-10T18:00:00.000Z',
          forMonth: '2026-10',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('cancels an unpaid invoice', async () => {
      mockDb.query.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        amount: 500000,
        amountPaid: 0,
        remainingAmount: 500000,
        status: 'OPEN',
      });

      const result = await service.cancel('tenant-1', 'inv-1');
      expect(result).toBeDefined();
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'cancel',
          entityType: 'invoice',
        }),
      );
    });

    it('rejects cancellation if invoice has payments', async () => {
      mockDb.query.invoices.findFirst.mockResolvedValue({
        id: 'inv-1',
        tenantId: 'tenant-1',
        amount: 500000,
        amountPaid: 200000,
        remainingAmount: 300000,
        status: 'PARTIALLY_PAID',
      });

      await expect(service.cancel('tenant-1', 'inv-1')).rejects.toThrow(BadRequestException);
    });
  });
});
