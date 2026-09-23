import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import {
  notifications,
  payments,
  students,
  tenants,
} from '../db/schema';
import { TelegramService } from '../telegram/telegram.service';
import { EskizProvider } from './sms/eskiz.provider';
import { PlayMobileProvider } from './sms/playmobile.provider';
import {
  QueryNotificationsDto,
  SendNotificationDto,
  UpdateNotificationSettingsDto,
} from './dto/notification.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly telegram: TelegramService,
    private readonly eskiz: EskizProvider,
    private readonly playmobile: PlayMobileProvider,
  ) {}

  async getSettings(tenantId: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        id: true,
        smsProvider: true,
        smsSender: true,
        smsApiToken: true,
        notifyOnAttendance: true,
        notifyOnPayment: true,
        notifyOnHomework: true,
      },
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    return {
      ...tenant,
      hasSmsApiToken: Boolean(tenant.smsApiToken),
      // Mask token for security
      smsApiToken: tenant.smsApiToken
        ? `${tenant.smsApiToken.slice(0, 4)}...${tenant.smsApiToken.slice(-4)}`
        : null,
    };
  }

  async updateSettings(tenantId: string, dto: UpdateNotificationSettingsDto) {
    const patch: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (dto.smsProvider !== undefined) patch.smsProvider = dto.smsProvider;
    if (dto.smsSender !== undefined) patch.smsSender = dto.smsSender;
    if (dto.smsApiToken !== undefined) patch.smsApiToken = dto.smsApiToken;
    if (dto.notifyOnAttendance !== undefined) patch.notifyOnAttendance = dto.notifyOnAttendance;
    if (dto.notifyOnPayment !== undefined) patch.notifyOnPayment = dto.notifyOnPayment;
    if (dto.notifyOnHomework !== undefined) patch.notifyOnHomework = dto.notifyOnHomework;

    await this.db.update(tenants).set(patch).where(eq(tenants.id, tenantId));
    return this.getSettings(tenantId);
  }

  async send(tenantId: string, dto: SendNotificationDto) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
    });

    let status: 'SENT' | 'FAILED' = 'SENT';
    let errorMessage: string | null = null;
    let providerName: string = 'system';
    let providerMessageId: string | null = null;

    if (dto.channel === 'TELEGRAM') {
      providerName = 'telegram';
      try {
        if (dto.studentId) {
          await this.telegram.notifyStudent(dto.studentId, dto.content);
        } else if (/^\d+$/.test(dto.recipient)) {
          await this.telegram.sendMessage(dto.recipient, dto.content);
        } else {
          this.logger.warn(`Telegram recipient ${dto.recipient} is not a valid chat ID, message mock-sent.`);
        }
        providerMessageId = `tg-${Date.now()}`;
      } catch (err) {
        status = 'FAILED';
        errorMessage = err instanceof Error ? err.message : String(err);
      }
    } else if (dto.channel === 'SMS') {
      const provider =
        tenant?.smsProvider === 'playmobile' ? this.playmobile : this.eskiz;
      providerName = provider.name;

      const result = await provider.sendSms(dto.recipient, dto.content, {
        sender: tenant?.smsSender || '4546',
        apiToken: tenant?.smsApiToken || undefined,
      });

      if (!result.success) {
        status = 'FAILED';
        errorMessage = result.error || 'SMS delivery failed';
      } else {
        providerMessageId = result.messageId || null;
      }
    }

    const [row] = await this.db
      .insert(notifications)
      .values({
        tenantId,
        userId: dto.userId || null,
        studentId: dto.studentId || null,
        channel: dto.channel,
        event: dto.event || 'MANUAL',
        status,
        recipient: dto.recipient,
        title: dto.title || null,
        content: dto.content,
        errorMessage,
        provider: providerName,
        providerMessageId,
        sentAt: status === 'SENT' ? new Date() : null,
      })
      .returning();

    return row;
  }

  async getLogs(tenantId: string, query?: QueryNotificationsDto) {
    const limit = Math.min(query?.limit || 50, 100);
    const offset = query?.offset || 0;

    const conditions = [eq(notifications.tenantId, tenantId)];
    if (query?.channel) {
      conditions.push(eq(notifications.channel, query.channel as any));
    }
    if (query?.status) {
      conditions.push(eq(notifications.status, query.status as any));
    }

    const list = await this.db.query.notifications.findMany({
      where: and(...conditions),
      orderBy: [desc(notifications.createdAt)],
      limit,
      offset,
      with: {
        student: {
          columns: { id: true, fullName: true, phone: true },
        },
      },
    });

    return list;
  }

  async getStats(tenantId: string) {
    const rows = await this.db
      .select({
        channel: notifications.channel,
        status: notifications.status,
        count: sql<number>`count(*)::int`,
      })
      .from(notifications)
      .where(eq(notifications.tenantId, tenantId))
      .groupBy(notifications.channel, notifications.status);

    let totalSent = 0;
    let totalFailed = 0;
    let telegramCount = 0;
    let smsCount = 0;

    for (const r of rows) {
      if (r.status === 'SENT') totalSent += r.count;
      if (r.status === 'FAILED') totalFailed += r.count;
      if (r.channel === 'TELEGRAM') telegramCount += r.count;
      if (r.channel === 'SMS') smsCount += r.count;
    }

    return {
      total: totalSent + totalFailed,
      totalSent,
      totalFailed,
      telegramCount,
      smsCount,
      successRate: totalSent + totalFailed > 0 ? Math.round((totalSent / (totalSent + totalFailed)) * 100) : 100,
    };
  }

  // --- Automated Event Triggers ---

  async notifyAttendance(tenantId: string, studentId: string, status: string, date: string, groupName: string) {
    try {
      const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      if (!tenant?.notifyOnAttendance) return;

      const student = await this.db.query.students.findFirst({
        where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
      });
      if (!student) return;

      const eventType = status === 'ABSENT' ? 'ATTENDANCE_ABSENT' : 'ATTENDANCE_LATE';
      const text =
        status === 'ABSENT'
          ? `Hurmatli ota-ona! Farzandingiz ${student.fullName} ${date} kuni "${groupName}" darsiga kelmadi. Sababi bo'lsa markazga xabar bering.`
          : `Hurmatli ota-ona! Farzandingiz ${student.fullName} ${date} kuni "${groupName}" darsiga kechikib keldi.`;

      // 1. Telegram
      if (student.telegramChatId) {
        void this.send(tenantId, {
          channel: 'TELEGRAM',
          event: eventType,
          recipient: student.telegramChatId,
          studentId: student.id,
          content: text,
        });
      }

      // 2. SMS to parent or student
      const phone = student.parentPhone || student.phone;
      if (phone) {
        void this.send(tenantId, {
          channel: 'SMS',
          event: eventType,
          recipient: phone,
          studentId: student.id,
          content: text,
        });
      }
    } catch (err) {
      this.logger.error(`Error in notifyAttendance: ${err}`);
    }
  }

  async notifyPaymentReceived(tenantId: string, studentId: string, amount: number, forMonth: string) {
    try {
      const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      if (!tenant?.notifyOnPayment) return;

      const student = await this.db.query.students.findFirst({
        where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
      });
      if (!student) return;

      const formatted = new Intl.NumberFormat('uz-UZ').format(amount);
      const text = `To'lov qabul qilindi: ${formatted} so'm (${forMonth} oyi uchun). Rahmat! CRMAPP`;

      if (student.telegramChatId) {
        void this.send(tenantId, {
          channel: 'TELEGRAM',
          event: 'PAYMENT_RECEIVED',
          recipient: student.telegramChatId,
          studentId: student.id,
          content: text,
        });
      }

      const phone = student.parentPhone || student.phone;
      if (phone) {
        void this.send(tenantId, {
          channel: 'SMS',
          event: 'PAYMENT_RECEIVED',
          recipient: phone,
          studentId: student.id,
          content: text,
        });
      }
    } catch (err) {
      this.logger.error(`Error in notifyPaymentReceived: ${err}`);
    }
  }

  async notifyHomeworkGraded(tenantId: string, studentId: string, homeworkTitle: string, score: number, feedback?: string) {
    try {
      const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) });
      if (!tenant?.notifyOnHomework) return;

      const student = await this.db.query.students.findFirst({
        where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
      });
      if (!student) return;

      const feedbackPart = feedback ? `\nIzoh: ${feedback}` : '';
      const text = `Vazifangiz baholandi!\n📝 "${homeworkTitle}"\n⭐️ Ball: ${score}${feedbackPart}`;

      if (student.telegramChatId) {
        void this.send(tenantId, {
          channel: 'TELEGRAM',
          event: 'HOMEWORK_GRADED',
          recipient: student.telegramChatId,
          studentId: student.id,
          content: text,
        });
      }
    } catch (err) {
      this.logger.error(`Error in notifyHomeworkGraded: ${err}`);
    }
  }

  async notifyDebtors(tenantId: string, forMonth?: string, targetStudentIds?: string[]) {
    const month = forMonth || new Date().toISOString().slice(0, 7);

    const studentList = await this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId)),
      with: {
        enrollments: {
          with: {
            group: true,
          },
        },
      },
    });

    const monthPayments = await this.db.query.payments.findMany({
      where: and(eq(payments.tenantId, tenantId), eq(payments.forMonth, month), eq(payments.status, 'PAID')),
    });

    const paidByStudent: Record<string, number> = {};
    for (const p of monthPayments) {
      paidByStudent[p.studentId] = (paidByStudent[p.studentId] || 0) + p.amount;
    }

    let sentCount = 0;
    for (const student of studentList) {
      if (targetStudentIds && targetStudentIds.length > 0 && !targetStudentIds.includes(student.id)) {
        continue;
      }

      const activeEnrollments = (student.enrollments || []).filter((e) => e.group);
      const expectedAmount = activeEnrollments.reduce((sum, e) => sum + (e.group?.monthlyPrice || 0), 0);
      const paidAmount = paidByStudent[student.id] || 0;
      const debt = expectedAmount - paidAmount;

      if (debt > 0) {
        const formattedDebt = new Intl.NumberFormat('uz-UZ').format(debt);
        const text = `Hurmatli o'quvchi / ota-ona! Sizning ${month} oyi uchun ${formattedDebt} so'm to'lovingiz mavjud. Iltimos, o'z vaqtida to'lovni amalga oshiring. CRMAPP`;

        if (student.telegramChatId) {
          void this.send(tenantId, {
            channel: 'TELEGRAM',
            event: 'PAYMENT_DUE',
            recipient: student.telegramChatId,
            studentId: student.id,
            content: text,
          });
        }

        const phone = student.parentPhone || student.phone;
        if (phone) {
          void this.send(tenantId, {
            channel: 'SMS',
            event: 'PAYMENT_DUE',
            recipient: phone,
            studentId: student.id,
            content: text,
          });
        }

        sentCount++;
      }
    }

    return { success: true, processedDebtors: sentCount };
  }
}
