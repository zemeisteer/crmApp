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

    service = new TelegramService(mockDb, mockConfig);
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

    expect(mockDb.update).toHaveBeenCalledTimes(2); // marked token consumed + linked student
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
});
