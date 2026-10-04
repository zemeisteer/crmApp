import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TelegramService } from './telegram.service';

describe('TelegramService (Secure Link Token)', () => {
  let service: TelegramService;
  let mockDb: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDb = {
      query: {
        students: {
          findFirst: vi.fn(),
        },
        telegramLinkTokens: {
          findFirst: vi.fn(),
        },
        users: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        enrollments: {
          findMany: vi.fn(),
        },
        homework: {
          findMany: vi.fn(),
        },
        attendance: {
          findMany: vi.fn(),
        },
        payments: {
          findMany: vi.fn(),
        },
        examResults: {
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
      // select(...).from(...)[.innerJoin/.where/.orderBy]: no parent chats
      select: vi.fn(() => {
        // oxlint-disable-next-line unicorn/no-thenable -- deliberately awaitable, like a drizzle builder
        const chain: any = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, then: (res: (v: unknown[]) => unknown) => res([]) };
        return chain;
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    mockConfig = {
      get: vi.fn((key: string) => {
        if (key === 'TELEGRAM_BOT_TOKEN') return 'fake-token-123';
        if (key === 'TELEGRAM_BOT_USERNAME') return 'talimcrm_test_bot';
        return null;
      }),
    };

    service = new TelegramService(mockDb, mockConfig, { available: false } as any, {} as any);
    // Mock sendMessage
    service.sendMessage = vi.fn().mockResolvedValue(undefined);
  });

  it('generates a 15-minute secure linking token for a valid student', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'student-1',
      tenantId: 'tenant-1',
      fullName: 'Aziz Rahimov',
    });

    const result = await service.generateLinkToken('tenant-1', 'student-1');

    expect(result.token).toBeDefined();
    expect(result.token.length).toBe(32); // 16 bytes hex = 32 chars
    expect(result.linkUrl).toContain(`start=link_${result.token}`);
    expect(result.studentName).toBe('Aziz Rahimov');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('throws NotFoundException if student is not found or belongs to another tenant', async () => {
    mockDb.query.students.findFirst.mockResolvedValue(null);

    await expect(service.generateLinkToken('tenant-1', 'student-foreign')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('links student when a valid active token is sent via /start', async () => {
    const validRecord = {
      id: 'token-id-1',
      token: 'abcd1234efgh5678',
      studentId: 'student-1',
      expiresAt: new Date(Date.now() + 600_000),
      student: { id: 'student-1', fullName: 'Aziz Rahimov' },
    };

    mockDb.query.telegramLinkTokens.findFirst.mockResolvedValue(validRecord);

    await service.handleUpdate({
      message: {
        text: '/start link_abcd1234efgh5678',
        chat: { id: 987654321 },
      },
    });

    expect(mockDb.update).toHaveBeenCalledTimes(3); // staff link on the chat dropped, token consumed + linked student
    expect(service.sendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('Aziz Rahimov'),
      expect.anything(),
    );
  });

  it('rejects an expired or non-existent token with an informative message', async () => {
    mockDb.query.telegramLinkTokens.findFirst.mockResolvedValue(null);
    mockDb.query.students.findFirst.mockResolvedValue(null);

    await service.handleUpdate({
      message: {
        text: '/start link_invalid_or_expired_token',
        chat: { id: 987654321 },
      },
    });

    expect(mockDb.update).not.toHaveBeenCalled();
    expect(service.sendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('muddati (15 daqiqa) o\'tgan'),
    );
  });

  it('responds with schedule for linked student when 📅 Dars jadvali is requested', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'student-1',
      fullName: 'Aziz Rahimov',
      telegramChatId: '987654321',
      tenant: { name: 'IT Center' },
    });

    mockDb.query.enrollments.findMany = vi.fn().mockResolvedValue([
      {
        groupId: 'group-1',
        group: {
          name: 'IELTS-01',
          subject: 'English',
          startTime: '16:00',
          scheduleDays: 'MON,WED,FRI',
          teacher: { fullName: 'Mr. John' },
          branch: { name: 'Main Campus' },
        },
      },
    ]);

    await service.handleUpdate({
      message: {
        text: '📅 Dars jadvali',
        chat: { id: 987654321 },
      },
    });

    expect(service.sendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining('IELTS-01'),
      expect.objectContaining({ keyboard: expect.any(Array) }),
    );
  });

  it('notifies exam result to student chat id when result is published', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'student-1',
      fullName: 'Aziz Rahimov',
      telegramChatId: '987654321',
    });

    await service.notifyExamResult('student-1', 'Midterm Test', 88, 100, "Zo'r natija!");

    expect(service.sendMessage).toHaveBeenCalledWith(
      '987654321',
      expect.stringContaining("Midterm Test"),
    );
  });

  it('a linked account without an active membership is not treated as staff', async () => {
    // Removed from the center (or never a member): the chat is just a chat.
    mockDb.query.users.findFirst.mockResolvedValue({ id: 'u1', fullName: 'Former Admin', tenantId: 't1', role: 'ADMIN' });
    mockDb.query.students.findFirst.mockResolvedValue(null);

    await service.handleUpdate({ message: { text: '/start', chat: { id: 556 } } });

    const sent = (service.sendMessage as any).mock.calls.map((c: unknown[]) => JSON.stringify(c[2] ?? ''));
    expect(sent.join(' ')).not.toContain('Bugungi holat');
  });

  it('answers a linked center admin with staff buttons, not the student cabinet', async () => {
    mockDb.query.users.findFirst.mockResolvedValue({ id: 'u1', fullName: 'Admin Aka', tenantId: 't1', role: 'ADMIN' });
    // The first lookup is the active membership in that center.
    const none = mockDb.select.getMockImplementation();
    mockDb.select.mockImplementationOnce(() => {
      // oxlint-disable-next-line unicorn/no-thenable -- deliberately awaitable, like a drizzle builder
      const chain: any = { from: () => chain, where: () => chain, then: (res: (v: unknown[]) => unknown) => res([{ role: 'ADMIN' }]) };
      return chain;
    });

    await service.handleUpdate({ message: { text: '/start', chat: { id: 555 } } });

    expect(mockDb.select.getMockImplementation()).toBe(none);
    expect(mockDb.query.students.findFirst).not.toHaveBeenCalled();
    const [, , keyboard] = (service.sendMessage as any).mock.calls[0];
    const labels = keyboard.keyboard.flat().map((b: { text: string }) => b.text);
    expect(labels).toContain('📊 Bugungi holat');
    expect(labels).not.toContain('🪪 Mening QR-kodim');
  });
});
