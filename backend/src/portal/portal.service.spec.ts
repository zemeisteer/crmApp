import * as bcrypt from 'bcryptjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortalService } from './portal.service';

describe('PortalService', () => {
  let service: PortalService;
  let mockDb: any;
  let mockJwt: any;
  let mockConfig: any;
  let mockLedger: any;

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
      getConfig: vi.fn().mockReturnValue({ clickEnabled: true, paymeEnabled: false }),
    };

    mockLedger = {
      currentMonth: vi.fn().mockResolvedValue(new Date().toISOString().slice(0, 7)),
      load: vi.fn().mockResolvedValue({ students: [], due: vi.fn() }),
    };
    service = new PortalService(mockDb, mockJwt, mockConfig, mockBilling as any, {} as any, { sendMessage: vi.fn() } as any, mockLedger, { register: vi.fn(), unregister: vi.fn() } as any);
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

  describe('verifyPhoneLogin', () => {
    const student = (pin: string | null) => {
      // PIN hashes live in their own table; stub the lookup.
      vi.spyOn(service as any, 'pinsFor').mockResolvedValue(new Map(pin ? [['student-1', bcrypt.hashSync(pin, 4)]] : []));
      return {
        id: 'student-1',
        fullName: 'Komil Aliyev',
        phone: '+998 90 123 45 67',
        tenantId: 'tenant-1',
        deletedAt: null,
        telegramChatId: null,
        tenant: { id: 'tenant-1', name: 'Apex Academy', subdomain: 'apex' },
      };
    };

    it("on a center's subdomain, only that center's students can sign in", async () => {
      mockDb.query.students.findMany.mockResolvedValue([student('482915')]);
      await expect(service.verifyPhoneLogin('+998901234567', { pin: '482915', subdomain: 'other' })).rejects.toThrow();
      const result = await service.verifyPhoneLogin('+998901234567', { pin: '482915', subdomain: 'APEX' });
      expect((result as { accessToken: string }).accessToken).toBe('mock-portal-token');
    });

    it('signs in with the PIN the center issued', async () => {
      mockDb.query.students.findMany.mockResolvedValue([student('482915')]);
      const result = await service.verifyPhoneLogin('+998901234567', { pin: '482915' });
      expect((result as { accessToken: string }).accessToken).toBe('mock-portal-token');
    });

    it('refuses a wrong PIN and a phone number alone', async () => {
      mockDb.query.students.findMany.mockResolvedValue([student('482915')]);
      await expect(service.verifyPhoneLogin('+998901234567', { pin: '000000' })).rejects.toThrow();
      await expect(service.verifyPhoneLogin('+998901234567', {})).rejects.toThrow();
    });
  });

  describe('getAttendance', () => {
    it('calculates attendance percentage and status distribution', async () => {
      // Newest first, as the query orders them.
      const en = { id: 'g1', name: 'English', subject: 'Ingliz tili' };
      const math = { id: 'g2', name: 'Math', subject: 'Matematika' };
      const mockRecords = [
        { id: 'att-5', groupId: 'g2', date: '2026-09-09', status: 'PRESENT', group: math },
        { id: 'att-4', groupId: 'g1', date: '2026-09-08', status: 'ABSENT', group: en },
        { id: 'att-3', groupId: 'g1', date: '2026-09-05', status: 'LATE', group: en },
        { id: 'att-2', groupId: 'g1', date: '2026-09-03', status: 'PRESENT', group: en },
        { id: 'att-1', groupId: 'g1', date: '2026-09-01', status: 'PRESENT', group: en },
      ];

      mockDb.query.attendance.findMany.mockResolvedValue(mockRecords);

      const res = await service.getAttendance('student-1', 'tenant-1');
      expect(res.total).toBe(5);
      expect(res.present).toBe(3);
      expect(res.late).toBe(1);
      expect(res.absent).toBe(1);
      // (3 + 0.5) / 5 * 100 = 70%
      expect(res.rate).toBe(70);
      expect(res.streak).toBe(1);
      expect(res.records[0]).toMatchObject({ groupName: 'Math', subject: 'Matematika' });
      expect(res.byGroup).toEqual([
        expect.objectContaining({ groupId: 'g1', groupName: 'English', total: 4, present: 2, late: 1, absent: 1, rate: 63 }),
        expect.objectContaining({ groupId: 'g2', groupName: 'Math', total: 1, present: 1, rate: 100 }),
      ]);
    });
  });

  describe('getPayments', () => {
    it('returns payment history and computes current tuition debt for active groups', async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);

      // The ledger (shared with the center's payments page) says what is owed.
      mockLedger.load.mockResolvedValue({
        students: [{ id: 'student-1' }],
        due: () => ({ expected: 600000, discount: 0, paid: 400000, debt: 200000 }),
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
