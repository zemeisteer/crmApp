import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

describe('AttendanceService - QR Check-in', () => {
  let service: AttendanceService;
  let mockDb: any;
  let mockTelegram: any;
  let mockWebhooks: any;
  let mockNotifications: any;

  beforeEach(() => {
    mockDb = {
      query: {
        groups: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        students: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        enrollments: {
          findMany: vi.fn(),
        },
        attendance: {
          findFirst: vi.fn(),
          findMany: vi.fn(),
        },
        payments: {
          findMany: vi.fn(),
        },
      },
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 'att-1', status: 'PRESENT' }]),
          }),
          returning: vi.fn().mockResolvedValue([{ id: 'att-1', status: 'PRESENT' }]),
        }),
      }),
    };

    mockTelegram = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
    };

    mockWebhooks = {
      dispatch: vi.fn().mockResolvedValue(undefined),
    };

    mockNotifications = {
      notifyAttendance: vi.fn().mockResolvedValue(undefined),
    };

    service = new AttendanceService(mockDb, mockTelegram, mockWebhooks, mockNotifications);
  });

  it('successfully checks in student via QR code and dispatches arrival notification', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'stu-123',
      tenantId: 'tenant-1',
      fullName: 'Jasur Bek',
      phone: '+998901234567',
      parentPhone: '+998909876543',
      telegramChatId: 'tg-999',
    });

    mockDb.query.enrollments.findMany.mockResolvedValue([
      {
        studentId: 'stu-123',
        groupId: 'grp-1',
        status: 'ACTIVE',
        group: {
          id: 'grp-1',
          name: 'IELTS Band 7+',
          monthlyPrice: 500000,
        },
      },
    ]);

    mockDb.query.attendance.findFirst.mockResolvedValue(null); // not marked yet today
    mockDb.query.payments.findMany.mockResolvedValue([
      { amount: 500000, status: 'PAID' },
    ]);

    const res = await service.qrCheckIn('tenant-1', {
      code: 'TALIMCRM:STUDENT:stu-123',
      date: '2026-09-22',
    });

    expect(res.success).toBe(true);
    expect(res.alreadyMarked).toBe(false);
    expect(res.student.fullName).toBe('Jasur Bek');
    expect(res.group.name).toBe('IELTS Band 7+');
    expect(res.attendance.status).toBe('PRESENT');
    expect(res.finance.hasDebt).toBe(false);
    expect(res.finance.totalPaid).toBe(500000);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockWebhooks.dispatch).toHaveBeenCalledWith('tenant-1', 'attendance.marked', expect.objectContaining({
      studentId: 'stu-123',
      status: 'PRESENT',
      via: 'QR_SCANNER',
    }));
    expect(mockTelegram.sendMessage).toHaveBeenCalledWith('tg-999', expect.stringContaining('Davomat qayd etildi'));
  });

  it('detects already marked attendance without re-inserting', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'stu-123',
      tenantId: 'tenant-1',
      fullName: 'Jasur Bek',
    });

    mockDb.query.enrollments.findMany.mockResolvedValue([
      {
        studentId: 'stu-123',
        groupId: 'grp-1',
        status: 'ACTIVE',
        group: { id: 'grp-1', name: 'IELTS Band 7+', monthlyPrice: 500000 },
      },
    ]);

    mockDb.query.attendance.findFirst.mockResolvedValue({
      status: 'PRESENT',
      date: '2026-09-22',
    });
    mockDb.query.payments.findMany.mockResolvedValue([]);

    const res = await service.qrCheckIn('tenant-1', {
      code: 'stu-123',
      date: '2026-09-22',
    });

    expect(res.success).toBe(true);
    expect(res.alreadyMarked).toBe(true);
    expect(res.attendance.status).toBe('PRESENT');
    expect(res.finance.hasDebt).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when student is not found in tenant', async () => {
    mockDb.query.students.findFirst.mockResolvedValue(null);

    await expect(
      service.qrCheckIn('tenant-1', { code: 'nonexistent-student' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when student has no active enrollments', async () => {
    mockDb.query.students.findFirst.mockResolvedValue({
      id: 'stu-inactive',
      tenantId: 'tenant-1',
      fullName: 'Inaktiv Talaba',
    });
    mockDb.query.enrollments.findMany.mockResolvedValue([]);

    await expect(
      service.qrCheckIn('tenant-1', { code: 'stu-inactive' }),
    ).rejects.toThrow(BadRequestException);
  });
});
