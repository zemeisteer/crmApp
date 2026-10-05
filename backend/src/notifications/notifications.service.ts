import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatZoned } from '../common/timezone';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { LedgerService } from '../ledger/ledger.service';
import {
  notifications,
  students,
  tenants,
  debtorReminders,
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
    private readonly ledger: LedgerService,
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
        remindPaymentDay: true,
        remindLessons: true,
        dailyDigest: true,
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
    if (dto.remindPaymentDay !== undefined) patch.remindPaymentDay = dto.remindPaymentDay;
    if (dto.remindLessons !== undefined) patch.remindLessons = dto.remindLessons;
    if (dto.dailyDigest !== undefined) patch.dailyDigest = dto.dailyDigest;

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

      // 1. Telegram: the student's chat and linked parents' chats
      const parentChats = await this.telegram.parentChatIds(student.id);
      if (student.telegramChatId || parentChats.length > 0) {
        void this.send(tenantId, {
          channel: 'TELEGRAM',
          event: eventType,
          recipient: student.telegramChatId ?? parentChats[0],
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
      const text = `To'lov qabul qilindi: ${formatted} so'm (${forMonth} oyi uchun). Rahmat! TalimCRM`;

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

  // Which channels can carry a message for this center right now.
  private async channelsReady(tenantId: string) {
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { smsApiToken: true, smsProvider: true, name: true } });
    const envToken = tenant?.smsProvider === 'playmobile' ? process.env.PLAYMOBILE_API_TOKEN : process.env.ESKIZ_API_TOKEN;
    return {
      centerName: tenant?.name ?? 'TalimCRM',
      // Outside production an SMS without a token is only logged (sandbox),
      // which is what local runs and tests want; in production it needs one.
      sms: Boolean(tenant?.smsApiToken || envToken) || process.env.NODE_ENV !== 'production',
      telegram: this.telegram.isConfigured,
    };
  }

  /**
   * The month's debtors who study now, with how each can be reached and
   * whether they were already reminded today (center day). Sends nothing.
   */
  async debtorReminderPreview(tenantId: string, forMonth?: string) {
    const month = forMonth || (await this.ledger.currentMonth(tenantId));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("forMonth YYYY-MM formatida bo'lishi kerak");
    const ledger = await this.ledger.load(tenantId, [month]);
    const today = formatZoned(new Date(), ledger.timezone).slice(0, 10);
    const ready = await this.channelsReady(tenantId);
    const sentToday = new Set(
      (await this.db.select({ studentId: debtorReminders.studentId }).from(debtorReminders)
        .where(and(eq(debtorReminders.tenantId, tenantId), eq(debtorReminders.forMonth, month), eq(debtorReminders.day, today)))).map((r) => r.studentId),
    );
    const debtors = ledger.students
      .filter((st) => !st.deleted && st.status === 'ACTIVE')
      .map((st) => ({ st, debt: ledger.due(st, month).debt }))
      .filter((x) => x.debt > 0)
      .map(({ st, debt }) => {
        const telegram = ready.telegram && Boolean(st.telegramChatId);
        const sms = ready.sms && Boolean(st.parentPhone || st.phone);
        return { studentId: st.id, fullName: st.fullName, debt, telegram, sms, remindedToday: sentToday.has(st.id) };
      })
      .sort((a, b) => b.debt - a.debt || a.fullName.localeCompare(b.fullName));
    return {
      forMonth: month,
      day: today,
      channels: { sms: ready.sms, telegram: ready.telegram },
      debtors,
      totals: {
        debtors: debtors.length,
        reachable: debtors.filter((d) => (d.telegram || d.sms) && !d.remindedToday).length,
        remindedToday: debtors.filter((d) => d.remindedToday).length,
        unreachable: debtors.filter((d) => !d.telegram && !d.sms).length,
      },
    };
  }

  /**
   * Reminds the month's debtors (or the chosen ones): at most once per
   * student, month and center day - the reminder is recorded first, so a
   * double click or two staff at once send one. Students that cannot be
   * reached (no channel configured, or no contact) are counted, not
   * "sent". The message is signed with the center's name.
   */
  async notifyDebtors(tenantId: string, forMonth?: string, targetStudentIds?: string[], userId?: string) {
    const preview = await this.debtorReminderPreview(tenantId, forMonth);
    const ready = await this.channelsReady(tenantId);
    const chosen = targetStudentIds?.length ? preview.debtors.filter((d) => targetStudentIds.includes(d.studentId)) : preview.debtors;
    const students = new Map((await this.ledger.load(tenantId, [preview.forMonth])).students.map((st) => [st.id, st]));
    let sent = 0;
    let alreadyToday = 0;
    let unreachable = 0;
    for (const d of chosen) {
      const st = students.get(d.studentId)!;
      const channels = [d.telegram ? 'TELEGRAM' : null, d.sms ? 'SMS' : null].filter(Boolean) as Array<'TELEGRAM' | 'SMS'>;
      if (channels.length === 0) {
        unreachable++;
        continue;
      }
      const [claimed] = await this.db
        .insert(debtorReminders)
        .values({ tenantId, studentId: d.studentId, forMonth: preview.forMonth, day: preview.day, debt: d.debt, channels: channels.join(','), sentById: userId ?? null })
        .onConflictDoNothing()
        .returning({ id: debtorReminders.id });
      if (!claimed) {
        alreadyToday++;
        continue;
      }
      const text = `Hurmatli o'quvchi / ota-ona! ${preview.forMonth} oyi uchun ${new Intl.NumberFormat('uz-UZ').format(d.debt)} so'm to'lov qoldi. Iltimos, to'lovni o'z vaqtida qiling. ${ready.centerName}`;
      if (channels.includes('TELEGRAM')) {
        void this.send(tenantId, { channel: 'TELEGRAM', event: 'PAYMENT_DUE', recipient: st.telegramChatId!, studentId: st.id, content: text });
      }
      if (channels.includes('SMS')) {
        void this.send(tenantId, { channel: 'SMS', event: 'PAYMENT_DUE', recipient: (st.parentPhone || st.phone)!, studentId: st.id, content: text });
      }
      sent++;
    }
    return {
      success: true,
      forMonth: preview.forMonth,
      sent,
      alreadyToday,
      unreachable,
      // Kept for older clients: the reminders actually sent now.
      processedDebtors: sent,
    };
  }
}
