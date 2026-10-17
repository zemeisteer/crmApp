import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockDb: any;
  let mockTelegram: any;
  let mockEskiz: any;
  let mockPlaymobile: any;
  // The tenant and its plan as the SMS route reads them (tenants join plans).
  let routeRow: Record<string, unknown>;

  beforeEach(() => {
    routeRow = { plan: 'STARTER', smsEnabled: true, smsApiToken: 'token123', smsProvider: 'eskiz', smsSender: '4546', smsIncluded: true };
    mockDb = {
      query: {
        tenants: {
          findFirst: vi.fn().mockResolvedValue({
            id: 'tenant-1',
            smsProvider: 'eskiz',
            smsSender: '4546',
            smsApiToken: 'token123',
            smsEnabled: true,
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
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockImplementation(() => Promise.resolve([routeRow])),
          }),
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
      parentChatIds: vi.fn().mockResolvedValue([]),
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
      { currentMonth: vi.fn(), load: vi.fn() } as any,
    );
  });

  it('settings say whether SMS is in the plan and on, and show no provider or token', async () => {
    const res = await service.getSettings('tenant-1');
    expect(res.sms).toEqual({ includedInPlan: true, enabled: true, providerReady: true });
    expect(JSON.stringify(res)).not.toContain('token123');
    expect(res).not.toHaveProperty('smsApiToken');

    routeRow.smsIncluded = false;
    expect((await service.getSettings('tenant-1')).sms.includedInPlan).toBe(false);
  });

  it('an SMS is not sent when the plan leaves SMS out, or the center has it off', async () => {
    routeRow.smsIncluded = false;
    await service.send('tenant-1', { recipient: '+998901234567', channel: 'SMS', content: 'x' });
    routeRow.smsIncluded = true;
    routeRow.smsEnabled = false;
    await service.send('tenant-1', { recipient: '+998901234567', channel: 'SMS', content: 'x' });
    expect(mockEskiz.sendSms).not.toHaveBeenCalled();
    expect(mockPlaymobile.sendSms).not.toHaveBeenCalled();
    const logged = mockDb.insert.mock.results[0].value.values.mock.calls.map((c: any) => c[0]);
    expect(logged.map((v: any) => [v.status, v.errorMessage])).toEqual([
      ['FAILED', 'SMS tarifingizga kiritilmagan'],
      ['FAILED', "SMS markaz sozlamalarida o'chirilgan"],
    ]);
  });

  it('a center without its own token sends through the platform account', async () => {
    routeRow.smsApiToken = null;
    const saved = { token: process.env.ESKIZ_API_TOKEN, sender: process.env.ESKIZ_SENDER };
    process.env.ESKIZ_API_TOKEN = 'platform-token';
    process.env.ESKIZ_SENDER = 'TalimCRM';
    try {
      await service.send('tenant-1', { recipient: '+998901234567', channel: 'SMS', content: 'x' });
      expect(mockEskiz.sendSms).toHaveBeenCalledWith('+998901234567', 'x', { sender: 'TalimCRM', apiToken: 'platform-token' });
    } finally {
      if (saved.token === undefined) delete process.env.ESKIZ_API_TOKEN; else process.env.ESKIZ_API_TOKEN = saved.token;
      if (saved.sender === undefined) delete process.env.ESKIZ_SENDER; else process.env.ESKIZ_SENDER = saved.sender;
    }
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
    // Sent without waiting (fire and forget): the SMS goes once its route is read.
    await vi.waitFor(() => expect(mockEskiz.sendSms).toHaveBeenCalled());
  });

  it('should return stats with success rate calculation', async () => {
    const stats = await service.getStats('tenant-1');
    expect(stats.totalSent).toBe(15);
    expect(stats.telegramCount).toBe(10);
    expect(stats.smsCount).toBe(5);
    expect(stats.successRate).toBe(100);
  });
});
