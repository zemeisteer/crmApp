import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExpensesService } from './expenses.service';

describe('ExpensesService', () => {
  let service: ExpensesService;
  let mockDb: any;
  let mockAudit: any;

  beforeEach(() => {
    mockDb = {
      query: {
        expenses: {
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
      delete: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue({}),
      }),
    };

    mockAudit = {
      log: vi.fn(),
    };

    service = new ExpensesService(mockDb, mockAudit);
  });

  describe('findAll', () => {
    it('returns expenses list filtered by tenant', async () => {
      const mockList = [
        { id: 'exp-1', title: 'Ijara', amount: 5000000, category: 'RENT', date: '2026-09-01' },
        { id: 'exp-2', title: 'Internet', amount: 300000, category: 'UTILITIES', date: '2026-09-05' },
      ];
      mockDb.query.expenses.findMany.mockResolvedValue(mockList);

      const result = await service.findAll('tenant-1', { forMonth: '2026-09' });
      expect(result).toEqual(mockList);
      expect(mockDb.query.expenses.findMany).toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('returns expense if found', async () => {
      const item = { id: 'exp-1', title: 'Ijara', amount: 5000000 };
      mockDb.query.expenses.findFirst.mockResolvedValue(item);

      const result = await service.findOne('tenant-1', 'exp-1');
      expect(result).toEqual(item);
    });

    it('throws NotFoundException if expense not found', async () => {
      mockDb.query.expenses.findFirst.mockResolvedValue(null);

      await expect(service.findOne('tenant-1', 'exp-none')).rejects.toThrow('Xarajat topilmadi');
    });
  });

  describe('summary', () => {
    it('aggregates total expenses and groups by category', async () => {
      const mockList = [
        { id: 'exp-1', amount: 5000000, category: 'RENT' },
        { id: 'exp-2', amount: 300000, category: 'UTILITIES' },
        { id: 'exp-3', amount: 200000, category: 'UTILITIES' },
        { id: 'exp-4', amount: 1500000, category: 'MARKETING' },
      ];
      mockDb.query.expenses.findMany.mockResolvedValue(mockList);

      const summary = await service.summary('tenant-1', '2026-09');
      expect(summary.totalAmount).toBe(7000000);
      expect(summary.count).toBe(4);
      expect(summary.byCategory).toEqual({
        RENT: 5000000,
        UTILITIES: 500000,
        MARKETING: 1500000,
      });
    });
  });

  describe('create', () => {
    it('inserts expense and logs audit event', async () => {
      const createdRow = {
        id: 'exp-new',
        tenantId: 'tenant-1',
        title: 'Qogoz va ruchkalar',
        category: 'SUPPLIES',
        amount: 250000,
        date: '2026-09-10',
      };
      mockDb.insert().values().returning.mockResolvedValue([createdRow]);
      mockDb.query.expenses.findFirst.mockResolvedValue(createdRow);

      const result = await service.create('tenant-1', 'user-1', {
        title: 'Qogoz va ruchkalar',
        category: 'SUPPLIES',
        amount: 250000,
        date: '2026-09-10',
      });

      expect(result).toEqual(createdRow);
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          userId: 'user-1',
          action: 'create',
          entityType: 'expense',
        }),
      );
    });
  });
});
