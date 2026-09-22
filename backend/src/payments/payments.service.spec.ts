import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockDb: any;
  let mockTelegram: any;
  let mockWebhooks: any;

  beforeEach(() => {
    mockDb = {
      query: {
        payments: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        students: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        expenses: {
          findMany: vi.fn(),
        },
        salaryPayments: {
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn(),
        }),
      }),
    };

    mockTelegram = {
      notifyStudent: vi.fn(),
    };

    mockWebhooks = {
      dispatch: vi.fn(),
    };

    const mockNotifications = {
      notifyPaymentReceived: vi.fn(),
      notifyDebtors: vi.fn(),
    };

    service = new PaymentsService(mockDb, mockTelegram, mockWebhooks, mockNotifications as any);
  });

  describe('getDebtors', () => {
    it('accurately computes debt based on student group prices and payments', async () => {
      const mockStudents = [
        {
          id: 'student-1',
          fullName: 'Anvar Karimov',
          phone: '+998901234567',
          parentPhone: '+998907654321',
          enrollments: [
            {
              group: {
                id: 'group-1',
                name: 'Ingliz tili B2',
                monthlyPrice: 500000,
                deletedAt: null,
              },
            },
            {
              group: {
                id: 'group-2',
                name: 'Matematika',
                monthlyPrice: 400000,
                deletedAt: null,
              },
            },
          ],
        },
        {
          id: 'student-2',
          fullName: 'Zarina Rustamova',
          phone: '+998931112233',
          parentPhone: null,
          enrollments: [
            {
              group: {
                id: 'group-1',
                name: 'Ingliz tili B2',
                monthlyPrice: 500000,
                deletedAt: null,
              },
            },
          ],
        },
        {
          id: 'student-3',
          fullName: 'Dilshod Saidov',
          phone: '+998945556677',
          parentPhone: null,
          enrollments: [
            {
              group: {
                id: 'group-3',
                name: 'Rus tili',
                monthlyPrice: 300000,
                deletedAt: null,
              },
            },
          ],
        },
      ];

      // Student 1 paid 500,000 out of 900,000 (debt = 400,000 -> PARTIAL)
      // Student 2 paid 500,000 out of 500,000 (debt = 0 -> PAID)
      // Student 3 paid 0 out of 300,000 (debt = 300,000 -> UNPAID)
      const mockPayments = [
        {
          studentId: 'student-1',
          amount: 500000,
          discount: 0,
          status: 'PAID',
          forMonth: '2026-09',
        },
        {
          studentId: 'student-2',
          amount: 500000,
          discount: 0,
          status: 'PAID',
          forMonth: '2026-09',
        },
      ];

      mockDb.query.students.findMany.mockResolvedValue(mockStudents);
      mockDb.query.payments.findMany.mockResolvedValue(mockPayments);

      const result = await service.getDebtors('tenant-1', '2026-09');

      expect(result.forMonth).toBe('2026-09');
      expect(result.totalExpected).toBe(1700000); // 900k + 500k + 300k
      expect(result.totalPaid).toBe(1000000); // 500k + 500k
      expect(result.totalDebt).toBe(700000); // 400k + 0 + 300k
      expect(result.debtorCount).toBe(2);
      expect(result.paidCount).toBe(1);
      expect(result.partialCount).toBe(1);
      expect(result.unpaidCount).toBe(1);

      const anvar = result.debtors.find((d) => d.studentId === 'student-1');
      expect(anvar?.status).toBe('PARTIAL');
      expect(anvar?.debtAmount).toBe(400000);

      const zarina = result.debtors.find((d) => d.studentId === 'student-2');
      expect(zarina?.status).toBe('PAID');
      expect(zarina?.debtAmount).toBe(0);

      const dilshod = result.debtors.find((d) => d.studentId === 'student-3');
      expect(dilshod?.status).toBe('UNPAID');
      expect(dilshod?.debtAmount).toBe(300000);
    });

    it('filters only debtors when onlyDebtors flag is true', async () => {
      mockDb.query.students.findMany.mockResolvedValue([
        {
          id: 's1',
          fullName: 'Student 1',
          enrollments: [{ group: { monthlyPrice: 500000, deletedAt: null } }],
        },
        {
          id: 's2',
          fullName: 'Student 2',
          enrollments: [{ group: { monthlyPrice: 500000, deletedAt: null } }],
        },
      ]);
      mockDb.query.payments.findMany.mockResolvedValue([
        { studentId: 's1', amount: 500000, status: 'PAID', forMonth: '2026-09' },
      ]);

      const result = await service.getDebtors('tenant-1', '2026-09', true);
      expect(result.debtors).toHaveLength(1);
      expect(result.debtors[0].studentId).toBe('s2');
    });
  });

  describe('getFinanceSummary', () => {
    it('computes net profit, revenue, expenses and collection rate accurately', async () => {
      // Setup payments (Revenue: 10,000,000)
      mockDb.query.payments.findMany.mockResolvedValue([
        { studentId: 's1', amount: 6000000, method: 'CASH', status: 'PAID', forMonth: '2026-09' },
        { studentId: 's2', amount: 4000000, method: 'CLICK', status: 'PAID', forMonth: '2026-09' },
        { studentId: 's3', amount: 1000000, method: 'CASH', status: 'FAILED', forMonth: '2026-09' },
      ]);

      // Setup expenses (Center Expenses: 4,000,000)
      mockDb.query.expenses.findMany.mockResolvedValue([
        { amount: 3000000, category: 'RENT', date: '2026-09-01' },
        { amount: 1000000, category: 'MARKETING', date: '2026-09-05' },
      ]);

      // Setup teacher salaries (Salaries: 3,500,000)
      mockDb.query.salaryPayments.findMany.mockResolvedValue([
        { amount: 2000000, forMonth: '2026-09' },
        { amount: 1500000, forMonth: '2026-09' },
      ]);

      // Students for debt calculation (Expected: 12,500,000)
      mockDb.query.students.findMany.mockResolvedValue([
        {
          id: 's1',
          fullName: 'S1',
          enrollments: [{ group: { monthlyPrice: 6000000, deletedAt: null } }],
        },
        {
          id: 's2',
          fullName: 'S2',
          enrollments: [{ group: { monthlyPrice: 4000000, deletedAt: null } }],
        },
        {
          id: 's4',
          fullName: 'S4',
          enrollments: [{ group: { monthlyPrice: 2500000, deletedAt: null } }],
        },
      ]);

      const summary = await service.getFinanceSummary('tenant-1', '2026-09');

      expect(summary.totalRevenue).toBe(10000000);
      expect(summary.totalCenterExpenses).toBe(4000000);
      expect(summary.totalSalaries).toBe(3500000);
      expect(summary.totalExpenses).toBe(7500000);
      expect(summary.netProfit).toBe(2500000); // 10m - 7.5m = 2.5m Net Profit!
      expect(summary.totalOutstandingDebt).toBe(2500000); // s4 owes 2.5m
      expect(summary.revenueByMethod).toEqual({
        CASH: 6000000,
        CLICK: 4000000,
      });
      expect(summary.expensesByCategory.RENT).toBe(3000000);
      expect(summary.expensesByCategory.MARKETING).toBe(1000000);
      expect(summary.expensesByCategory.SALARY).toBe(3500000);
    });
  });
});
