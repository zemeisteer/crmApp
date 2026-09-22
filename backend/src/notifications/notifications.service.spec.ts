import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDb: any;
  let mockTelegram: any;
  let mockEskiz: any;
  let mockPlaymobile: any;

  beforeEach(() => {
    mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'tenant-1',
            smsProvider: 'eskiz',
            smsSender: '4546',
            smsApiToken: 'token123',
            notifyOnAttendance: true,
            notifyOnPayment: true,
            notifyOnHomework: true,
          }),
        },
        notifications: {
          findMany: vi.fn().mockResolvedValue([
            { id: 'notif-1', recipient: '+998901234567', channel: 'SMS', status: 'SENT' },
          ]),
        },
        students: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'student-1',
            fullName: 'Ali Valiyev',
            phone: '+998901234567',
            parentPhone: '+998907654321',
            telegramChatId: '12345678',
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        payments: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'notif-new', status: 'SENT' }]),
        }),
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { channel: 'SMS', status: 'SENT', count: 5 },
              { channel: 'TELEGRAM', status: 'SENT', count: 10 },
            ]),
          }),
        }),
      }),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue(true),
      notifyStudent: vi.fn().mockResolvedValue(true),
    };

    mockEskiz = {
      name: 'eskiz',
      sendSms: vi.fn().mockResolvedValue({ success: true, messageId: 'eskiz-123' }),
    };

    mockPlaymobile = {
      name: 'playmobile',
      sendSms: vi.fn().mockResolvedValue({ success: true, messageId: 'pm-123' }),
    };

    service = new NotificationsService(
      mockDb,
      mockTelegram,
      mockEskiz,
      mockPlaymobile,
    );
  });

  it('should return masked settings', async () => {
    const res = await service.getSettings('tenant-1');
    expect(res.smsProvider).toBe('eskiz');
    expect(res.hasSmsApiToken).toBe(true);
    expect(res.smsApiToken).toBe('toke...n123');
  });

  it('should send SMS via configured provider', async () => {
    const res = await service.send('tenant-1', {
      recipient: '+998901234567',
      channel: 'SMS',
      content: 'Test SMS',
    });

    expect(mockEskiz.sendSms).toHaveBeenCalledWith(
      '+998901234567',
      'Test SMS',
      expect.objectContaining({ sender: '4546' }),
    );
    expect(res.id).toBe('notif-new');
  });

  it('should send Telegram notification to student', async () => {
    await service.send('tenant-1', {
      recipient: '12345678',
      channel: 'TELEGRAM',
      studentId: 'student-1',
      content: 'Test Telegram',
    });

    expect(mockTelegram.notifyStudent).toHaveBeenCalledWith('student-1', 'Test Telegram');
  });

  it('should trigger attendance notification to telegram and parent phone', async () => {
    await service.notifyAttendance('tenant-1', 'student-1', 'ABSENT', '2026-09-22', 'Ingliz tili B2');

    expect(mockTelegram.notifyStudent).toHaveBeenCalled();
    expect(mockEskiz.sendSms).toHaveBeenCalled();
  });

  it('should return stats with success rate calculation', async () => {
    const stats = await service.getStats('tenant-1');
    expect(stats.totalSent).toBe(15);
    expect(stats.telegramCount).toBe(10);
    expect(stats.smsCount).toBe(5);
    expect(stats.successRate).toBe(100);
  });
});
