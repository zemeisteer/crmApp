import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalService } from './portal.service';

describe('PortalService', () => {
  let service: PortalService;
  let mockDb: any;
  let mockJwt: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDb = {
      query: {
        telegramLinkTokens: {
          findFirst: vi.fn(),
        },
        students: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        enrollments: {
          findMany: vi.fn(),
        },
        schedules: {
          findMany: vi.fn(),
        },
        attendance: {
          findMany: vi.fn(),
        },
        homework: {
          findMany: vi.fn(),
          findFirst: vi.fn(),
        },
        homeworkCompletions: {
          findFirst: vi.fn(),
        },
        examAttempts: {
          findMany: vi.fn(),
        },
        examResults: {
          findMany: vi.fn(),
        },
        certificates: {
          findMany: vi.fn(),
        },
        payments: {
          findMany: vi.fn(),
        },
        announcements: {
          findMany: vi.fn(),
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
    };

    mockJwt = {
      signAsync: vi.fn().mockResolvedValue('mock-portal-token'),
      verifyAsync: vi.fn(),
    };

    mockConfig = {
      get: vi.fn().mockReturnValue('mock-jwt-secret'),
    };

    const mockBilling = {
      generateClickLink: vi.fn().mockResolvedValue({ url: 'https://my.click.uz/pay?id=123', transactionId: 'tx-1' }),
      generatePaymeLink: vi.fn().mockResolvedValue({ url: 'https://checkout.paycom.uz/abc', transactionId: 'tx-2' }),
    };

    service = new PortalService(mockDb, mockJwt, mockConfig, mockBilling as any);
  });

  describe('loginWithToken', () => {
    it('authenticates student when valid token is provided and marks token as used', async () => {
      const mockRecord = {
        id: 'token-1',
        token: 'abc123token',
        expiresAt: new Date(Date.now() + 60000),
        usedAt: null,
        student: {
          id: 'student-1',
          fullName: 'Sardor Rahimiy',
          phone: '+998901234567',
          tenantId: 'tenant-1',
        },
        tenant: {
          id: 'tenant-1',
          name: 'Apex Academy',
          subdomain: 'apex',
          logoUrl: null,
          phone: '+998712000000',
          address: 'Toshkent sh.',
        },
      };

      mockDb.query.telegramLinkTokens.findFirst.mockResolvedValue(mockRecord);

      const result = await service.loginWithToken('abc123token');

      expect(result.accessToken).toBe('mock-portal-token');
      expect(result.student.fullName).toBe('Sardor Rahimiy');
      expect(result.tenant.name).toBe('Apex Academy');
      expect(mockDb.update).toHaveBeenCalled();
    });

    it('rejects if token is expired or not found', async () => {
      mockDb.query.telegramLinkTokens.findFirst.mockResolvedValue(null);

      await expect(service.loginWithToken('invalid-token')).rejects.toThrow(
        "Havola muddati o'tgan yoki noto'g'ri",
      );
    });
  });

  describe('loginWithPhone', () => {
    it('matches student by phone digits and signs access token', async () => {
      const mockStudents = [
        {
          id: 'student-1',
          fullName: 'Komil Aliyev',
          phone: '+998 90 123 45 67',
          tenantId: 'tenant-1',
          deletedAt: null,
          tenant: { id: 'tenant-1', name: 'Apex Academy' },
        },
      ];

      mockDb.query.students.findMany.mockResolvedValue(mockStudents);

      const result = await service.loginWithPhone('+998901234567');
      expect(result.accessToken).toBe('mock-portal-token');
      expect(result.student.fullName).toBe('Komil Aliyev');
    });
  });

  describe('getAttendance', () => {
    it('calculates attendance percentage and status distribution', async () => {
      const mockRecords = [
        { id: 'att-1', date: '2026-09-01', status: 'PRESENT' },
        { id: 'att-2', date: '2026-09-03', status: 'PRESENT' },
        { id: 'att-3', date: '2026-09-05', status: 'LATE' },
        { id: 'att-4', date: '2026-09-08', status: 'ABSENT' },
      ];

      mockDb.query.attendance.findMany.mockResolvedValue(mockRecords);

      const res = await service.getAttendance('student-1', 'tenant-1');
      expect(res.total).toBe(4);
      expect(res.present).toBe(2);
      expect(res.late).toBe(1);
      expect(res.absent).toBe(1);
      // (2 + 0.5) / 4 * 100 = 63%
      expect(res.rate).toBe(63);
    });
  });

  describe('getPayments', () => {
    it('returns payment history and computes current tuition debt for active groups', async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);

      mockDb.query.students.findFirst.mockResolvedValue({
        id: 'student-1',
        enrollments: [
          {
            group: {
              id: 'group-1',
              monthlyPrice: 600000,
              deletedAt: null,
            },
          },
        ],
      });

      mockDb.query.payments.findMany.mockResolvedValue([
        {
          id: 'pay-1',
          amount: 400000,
          discount: 0,
          status: 'PAID',
          forMonth: currentMonth,
        },
      ]);

      const res = await service.getPayments('student-1', 'tenant-1');
      expect(res.expectedTuition).toBe(600000);
      expect(res.monthPaid).toBe(400000);
      expect(res.debtAmount).toBe(200000); // 600k - 400k = 200k
      expect(res.status).toBe('PARTIAL');
      expect(res.history).toHaveLength(1);
    });
  });

  describe('createCheckoutLink', () => {
    it('generates Click and Payme checkout links', async () => {
      const res = await service.createCheckoutLink('student-1', 'tenant-1', {
        provider: 'CLICK',
        amount: 250000,
        forMonth: '2026-09',
      });
      expect(res.url).toContain('click.uz');
      expect(res.transactionId).toBe('tx-1');
    });
  });
});
