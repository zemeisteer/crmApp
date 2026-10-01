import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsService } from './payments.service';
import { monthDue } from '../ledger/ledger';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let mockDb: any;
  let mockTelegram: any;
  let mockWebhooks: any;
  // What the ledger loader would return: students with their enrollments,
  // and each student's PAID payments of the month.
  let students: any[];
  let monthPayments: Record<string, Array<{ amount: number; discount: number; allocated: number | null }>>;
  const student = (id: string, fullName: string, prices: number[]) => ({
    id, fullName, phone: null, parentPhone: null, telegramChatId: null, status: 'ACTIVE', createdMonth: '2026-01',
    leftAt: null, leftReason: null, leftMonth: null, pausedMonth: null, deletedMonth: null, deleted: false,
    enrollments: prices.map((price, n) => ({
      id: `${id}-e${n}`, groupId: `${id}-g${n}`, groupName: `Group ${n}`, status: 'ACTIVE', joinedMonth: '2026-01',
      leftMonth: null, groupDeletedMonth: null, prices: [{ from: '2026-01', price }],
    })),
  });

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

    const mockAudit = {
      log: vi.fn(),
    };

    students = [];
    monthPayments = {};
    const mockLedger = {
      currentMonth: vi.fn().mockResolvedValue('2026-09'),
      load: vi.fn().mockImplementation(async () => ({
        timezone: 'Asia/Tashkent',
        currentMonth: '2026-09',
        students,
        due: (st: any, month: string) => monthDue(st, month, [], monthPayments[st.id] ?? []),
      })),
    };

    service = new PaymentsService(mockDb, mockTelegram, mockWebhooks, mockNotifications as any, mockAudit as any, mockLedger as any);
  });

  describe('getDebtors', () => {
    it('accurately computes debt based on student group prices and payments', async () => {
      // Student 1 paid 500,000 out of 900,000 (debt = 400,000 -> PARTIAL)
      // Student 2 paid 500,000 out of 500,000 (debt = 0 -> PAID)
      // Student 3 paid 0 out of 300,000 (debt = 300,000 -> UNPAID)
      students = [
        student('student-1', 'Anvar Karimov', [500000, 400000]),
        student('student-2', 'Zarina Rustamova', [500000]),
        student('student-3', 'Dilshod Saidov', [300000]),
      ];
      monthPayments = {
        'student-1': [{ amount: 500000, discount: 0, allocated: null }],
        'student-2': [{ amount: 500000, discount: 0, allocated: null }],
      };

      const result = await service.getDebtors('tenant-1', '2026-09');

      expect(result.forMonth).toBe('2026-09');
      expect(result.totalExpected).toBe(1700000); // 900k + 500k + 300k
      expect(result.totalPaid).toBe(1000000); // 500k + 500k
      expect(result.totalDebt).toBe(700000); // 400k + 0 + 300k
      expect(result.debtorCount).toBe(2);
      expect(result.paidCount).toBe(1);
      expect(result.partialCount).toBe(1);
      expect(result.unpaidCount).toBe(1);
      // The list and the totals are the same numbers.
      expect(result.debtors.reduce((sum, d) => sum + d.debtAmount, 0)).toBe(result.totalDebt);

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
      students = [student('s1', 'Student 1', [500000]), student('s2', 'Student 2', [500000])];
      monthPayments = { s1: [{ amount: 500000, discount: 0, allocated: null }] };

      const result = await service.getDebtors('tenant-1', '2026-09', true);
      expect(result.debtors).toHaveLength(1);
      expect(result.debtors[0].studentId).toBe('s2');
    });

    it('rejects a month that is not YYYY-MM', async () => {
      await expect(service.getDebtors('tenant-1', '2026-13')).rejects.toThrow();
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
      students = [student('s1', 'S1', [6000000]), student('s2', 'S2', [4000000]), student('s4', 'S4', [2500000])];
      monthPayments = {
        s1: [{ amount: 6000000, discount: 0, allocated: null }],
        s2: [{ amount: 4000000, discount: 0, allocated: null }],
      };

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
