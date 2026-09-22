import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { attendance, enrollments, groups, payments, students } from '../db/schema';
import { MarkAttendanceDto, QrCheckInDto, QueryAttendanceDto } from './dto/attendance.dto';
import { TelegramService } from '../telegram/telegram.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly webhooks: WebhooksService,
    private readonly notifications: NotificationsService,
  ) {}

  async mark(tenantId: string, dto: MarkAttendanceDto) {
    const group = await this.db.query.groups.findFirst({
      where: and(eq(groups.id, dto.groupId), eq(groups.tenantId, tenantId)),
    });
    if (!group) {
      throw new NotFoundException('Guruh topilmadi');
    }

    const rows = await Promise.all(
      dto.entries.map((entry) =>
        this.db
          .insert(attendance)
          .values({
            tenantId,
            groupId: dto.groupId,
            studentId: entry.studentId,
            date: dto.date,
            status: entry.status as any,
          })
          .onConflictDoUpdate({
            target: [attendance.studentId, attendance.groupId, attendance.date],
            set: { status: entry.status as any, updatedAt: new Date() },
          })
          .returning(),
      ),
    );

    const absentOrLate = dto.entries.filter((e) => e.status === 'ABSENT' || e.status === 'LATE');
    if (absentOrLate.length > 0) {
      const groupName = group?.name ?? 'guruh';
      for (const entry of absentOrLate) {
        void this.notifications.notifyAttendance(
          tenantId,
          entry.studentId,
          entry.status,
          dto.date,
          groupName,
        );
      }
    }

    const flat = rows.flat();
    void this.webhooks.dispatch(tenantId, 'attendance.marked', { groupId: dto.groupId, date: dto.date, entries: flat });
    return flat;
  }

  findAll(tenantId: string, query: QueryAttendanceDto) {
    const conditions = [eq(attendance.tenantId, tenantId)];
    if (query.groupId) conditions.push(eq(attendance.groupId, query.groupId));
    if (query.date) conditions.push(eq(attendance.date, query.date));
    if (query.studentId) conditions.push(eq(attendance.studentId, query.studentId));

    return this.db.query.attendance.findMany({
      where: and(...conditions),
      orderBy: (a, { desc }) => desc(a.date),
    });
  }

  async qrCheckIn(tenantId: string, dto: QrCheckInDto) {
    let studentId = (dto.code || '').trim();
    if (studentId.startsWith('TALIMCRM:STUDENT:')) {
      studentId = studentId.replace('TALIMCRM:STUDENT:', '');
    } else if (studentId.startsWith('STUDENT_')) {
      studentId = studentId.replace('STUDENT_', '');
    }

    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    const activeEnrollments = await this.db.query.enrollments.findMany({
      where: and(eq(enrollments.studentId, student.id), eq(enrollments.status, 'ACTIVE')),
      with: {
        group: true,
      },
    });

    if (activeEnrollments.length === 0) {
      throw new BadRequestException("O'quvchi hech qanday faol guruhga biriktirilmagan");
    }

    let targetGroup = activeEnrollments[0].group;
    if (dto.groupId) {
      const matched = activeEnrollments.find((e) => e.groupId === dto.groupId);
      if (matched) {
        targetGroup = matched.group;
      }
    }

    const targetDate = dto.date || new Date().toISOString().slice(0, 10);
    const existing = await this.db.query.attendance.findFirst({
      where: and(
        eq(attendance.tenantId, tenantId),
        eq(attendance.studentId, student.id),
        eq(attendance.groupId, targetGroup.id),
        eq(attendance.date, targetDate),
      ),
    });

    let status = 'PRESENT';
    let alreadyMarked = false;

    if (existing) {
      alreadyMarked = true;
      status = existing.status;
    } else {
      await this.db
        .insert(attendance)
        .values({
          tenantId,
          groupId: targetGroup.id,
          studentId: student.id,
          date: targetDate,
          status: status as any,
        })
        .onConflictDoUpdate({
          target: [attendance.studentId, attendance.groupId, attendance.date],
          set: { status: status as any, updatedAt: new Date() },
        });

      void this.webhooks.dispatch(tenantId, 'attendance.marked', {
        groupId: targetGroup.id,
        date: targetDate,
        studentId: student.id,
        status,
        via: 'QR_SCANNER',
      });

      const arrivalTime = new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
      const notificationText = `✅ <b>Davomat qayd etildi</b>\n\n👤 <b>O'quvchi:</b> ${student.fullName}\n👥 <b>Guruh:</b> ${targetGroup.name}\n⏰ <b>Kelgan vaqti:</b> ${arrivalTime}\n📅 <b>Sana:</b> ${targetDate}\n\n<i>O'quv markaziga muvaffaqiyatli yetib keldi.</i>`;

      if (student.telegramChatId) {
        void this.telegram.sendMessage(student.telegramChatId, notificationText);
      }
    }

    const studentPayments = await this.db.query.payments.findMany({
      where: and(
        eq(payments.tenantId, tenantId),
        eq(payments.studentId, student.id),
        eq(payments.status, 'PAID'),
      ),
    });
    const totalPaid = studentPayments.reduce((acc, p) => acc + p.amount, 0);
    const monthlyFee = targetGroup.monthlyPrice || 0;
    const hasDebt = monthlyFee > 0 && totalPaid === 0;

    return {
      success: true,
      alreadyMarked,
      student: {
        id: student.id,
        fullName: student.fullName,
        phone: student.phone,
        parentPhone: student.parentPhone,
        telegramLinked: Boolean(student.telegramChatId),
      },
      group: {
        id: targetGroup.id,
        name: targetGroup.name,
        monthlyPrice: targetGroup.monthlyPrice,
      },
      attendance: {
        date: targetDate,
        status,
        time: new Date().toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
      },
      finance: {
        monthlyPrice: monthlyFee,
        totalPaid,
        hasDebt,
      },
    };
  }
}

