import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SalaryService } from './salary.service';

describe('SalaryService', () => {
  let service: SalaryService;
  let mockDb: any;
  let ledger: { currentMonth: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockDb = {
      query: {
        teachers: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        salaryPayments: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        groups: {
          findMany: vi.fn(),
        },
        schedules: {
          findMany: vi.fn(),
        },
        payments: {
          findMany: vi.fn(),
        },
        enrollments: {
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn(),
          }),
          returning: vi.fn(),
        }),
      }),
    };

    // t-2 teaches 3 lessons this month and t-1 missed 1 of their 20.
    const attendance = {
      monthStats: vi.fn().mockResolvedValue(new Map([
        ['t-1', { planned: 20, absent: 1, late: 0, substituted: 0 }],
        ['t-2', { planned: 3, absent: 0, late: 0, substituted: 0 }],
      ])),
    };
    ledger = { currentMonth: vi.fn().mockResolvedValue('2026-10') };
    service = new SalaryService(mockDb, attendance as any, ledger as any, { log: vi.fn() } as any);
  });

  describe('calculatePayroll', () => {
    it('calculates payroll for FIXED, PER_LESSON and PERCENTAGE, minus missed lessons', async () => {
      const mockTeachers = [
        { id: 't-1', fullName: 'Alisher Navoiy', phone: '+998901112233', subject: 'Matematika', salaryType: 'FIXED', salaryValue: 5000000 },
        { id: 't-2', fullName: 'Bobur Mirzo', phone: '+998902223344', subject: 'Ingliz tili', salaryType: 'PER_LESSON', salaryValue: 100000 },
        { id: 't-3', fullName: 'Mirzo Ulugbek', phone: '+998903334455', subject: 'Fizika', salaryType: 'PERCENTAGE', salaryValue: 40 },
      ];
      mockDb.query.teachers.findMany.mockResolvedValue(mockTeachers);

      // t-1 has 2000000 already paid, in two installments
      mockDb.query.salaryPayments.findMany.mockResolvedValue([
        { teacherId: 't-1', amount: 1500000, forMonth: '2026-09', paidAt: new Date('2026-09-10') },
        { teacherId: 't-1', amount: 500000, forMonth: '2026-09', paidAt: new Date('2026-09-20') },
      ]);

      mockDb.query.groups.findMany.mockResolvedValue([
        { id: 'g-1', teacherId: 't-2', name: 'Group English' },
        { id: 'g-2', teacherId: 't-3', name: 'Group Physics' },
      ]);

      // t-2 has 12 lessons (date-specific or recurring)
      mockDb.query.schedules.findMany.mockResolvedValue([
        { id: 's-1', teacherId: 't-2', groupId: 'g-1', date: '2026-09-02', status: 'COMPLETED' },
        { id: 's-2', teacherId: 't-2', groupId: 'g-1', date: '2026-09-04', status: 'COMPLETED' },
        { id: 's-3', teacherId: 't-2', groupId: 'g-1', date: '2026-09-09', status: 'COMPLETED' },
      ]);

      // t-3 teaches g-2 with student st-1
      mockDb.query.enrollments.findMany.mockResolvedValue([
        { groupId: 'g-2', studentId: 'st-1' },
      ]);

      // st-1 paid 1,000,000 tuition
      mockDb.query.payments.findMany.mockResolvedValue([
        { studentId: 'st-1', amount: 1000000, forMonth: '2026-09', status: 'PAID' },
      ]);

      const result = await service.calculatePayroll('tenant-1', '2026-09');

      expect(result.teacherCount).toBe(3);
      expect(result.forMonth).toBe('2026-09');

      // t-1: FIXED 5,000,000 minus 1 of 20 missed lessons (250,000) = 4,750,000;
      // paid 2,000,000 => netPayable 2,750,000
      const p1 = result.teachers.find((t) => t.teacherId === 't-1');
      expect(p1?.details.deduction).toBe(250000);
      expect(p1?.calculatedSalary).toBe(4750000);
      expect(p1?.paidAmount).toBe(2000000);
      expect(p1?.netPayable).toBe(2750000);
      expect(p1?.isPaid).toBe(false);
      expect(p1?.installments).toBe(2);
      expect(p1?.paidAt).toEqual(new Date('2026-09-20'));

      // t-2: PER_LESSON 3 lessons * 100,000 => 300,000, paid 0 => netPayable 300,000
      const p2 = result.teachers.find((t) => t.teacherId === 't-2');
      expect(p2?.calculatedSalary).toBe(300000);
      expect(p2?.paidAmount).toBe(0);
      expect(p2?.netPayable).toBe(300000);

      // t-3: PERCENTAGE 40% of 1,000,000 => 400,000
      const p3 = result.teachers.find((t) => t.teacherId === 't-3');
      expect(p3?.calculatedSalary).toBe(400000);
      expect(p3?.paidAmount).toBe(0);
      expect(p3?.netPayable).toBe(400000);

      expect(result.totalCalculated).toBe(5450000);
      expect(result.totalPaid).toBe(2000000);
      expect(result.totalPending).toBe(3450000);
    });
  });

  it("without a month, uses the center's current month (its own clock)", async () => {
    mockDb.query.teachers.findMany.mockResolvedValue([]);
    const result = await service.calculatePayroll('tenant-1');
    expect(ledger.currentMonth).toHaveBeenCalledWith('tenant-1');
    expect(result.forMonth).toBe('2026-10');
  });

  it('refuses a month that is not YYYY-MM', async () => {
    await expect(service.calculatePayroll('tenant-1', '2026-13')).rejects.toThrow('YYYY-MM');
  });
});
