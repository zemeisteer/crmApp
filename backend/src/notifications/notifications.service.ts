import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { formatZoned } from '../common/timezone';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { DB, Database } from '../db/db.module';
import { LedgerService } from '../ledger/ledger.service';
import {
  notifications,
  plans,
  students,
  tenants,
  debtorReminders,
  smsSends,
} from '../db/schema';
import { centerWorkRefusal } from '../trial/trial-access';
import { TelegramService } from '../telegram/telegram.service';
import { EskizProvider } from './sms/eskiz.provider';
import { PlayMobileProvider } from './sms/playmobile.provider';
import { flagOn } from '../feature-flags/flags';
import {
  QueryNotificationsDto,
  SendNotificationDto,
  UpdateNotificationSettingsDto,
} from './dto/notification.dto';

/**
 * The platform account's SMS budget: PLATFORM_SMS_PER_CENTER_MONTH (1000) per
 * center and PLATFORM_SMS_PER_MONTH (0 = no cap) in all, per UTC month. Empty
 * (as docker-compose passes an unset one) means the default.
 */
export function smsBudget() {
  const env = (k: string, d: number) => {
    const v = Number(process.env[k]?.trim() || d);
    return Number.isFinite(v) && v >= 0 ? v : d;
  };
  return { perCenter: env('PLATFORM_SMS_PER_CENTER_MONTH', 1000), total: env('PLATFORM_SMS_PER_MONTH', 0), month: new Date().toISOString().slice(0, 7) };
}
/** What counts against the budget: messages on their way, sent, or of unknown fate. */
export const SMS_COUNTED = ['RESERVED', 'SENT', 'UNKNOWN'];

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

  /**
   * How an SMS of this center goes out, or why it does not: the center must
   * exist and run (ACTIVE, or a trial that has not ended - trial-access.ts),
   * its plan must be one the platform lists and include SMS, and the center
   * must have it on. The provider account is the platform's (Eskiz, else
   * PlayMobile; `platformAccount`, counted against the monthly budget); a
   * center that once entered its own token keeps using it. `configured`: a
   * real token is there (without one the provider only logs the message
   * outside production).
   */
  async smsRoute(tenantId: string): Promise<
    | { ok: true; provider: 'eskiz' | 'playmobile'; token: string | undefined; sender: string; configured: boolean; platformAccount: boolean }
    | { ok: false; reason: 'NO_CENTER' | 'CENTER_INACTIVE' | 'NOT_IN_PLAN' | 'OFF' | 'DISABLED'; message: string }
  > {
    const [row] = await this.db
      .select({
        status: tenants.status,
        trialEndsAt: tenants.trialEndsAt,
        planKey: plans.key,
        plan: tenants.plan,
        smsEnabled: tenants.smsEnabled,
        smsApiToken: tenants.smsApiToken,
        smsProvider: tenants.smsProvider,
        smsSender: tenants.smsSender,
        smsIncluded: plans.smsIncluded,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.key, tenants.plan))
      .where(eq(tenants.id, tenantId));
    if (!row) return { ok: false, reason: 'NO_CENTER', message: 'Markaz topilmadi' };
    // The platform's switch (feature-flags/flags.ts): an emergency stop for all SMS.
    if (!(await flagOn(this.db, 'sms', tenantId))) return { ok: false, reason: 'DISABLED', message: "SMS yuborish vaqtincha o'chirilgan" };
    if (centerWorkRefusal(row)) return { ok: false, reason: 'CENTER_INACTIVE', message: "Markaz faol emas (sinov muddati tugagan yoki to'xtatilgan)" };
    if (row.smsIncluded === false) return { ok: false, reason: 'NOT_IN_PLAN', message: 'SMS tarifingizga kiritilmagan' };
    if (!row.smsEnabled) return { ok: false, reason: 'OFF', message: "SMS markaz sozlamalarida o'chirilgan" };
    if (row.smsApiToken) {
      return { ok: true, provider: row.smsProvider === 'playmobile' ? 'playmobile' : 'eskiz', token: row.smsApiToken, sender: row.smsSender || '4546', configured: true, platformAccount: false };
    }
    // The platform's account: only for a plan it lists that includes SMS.
    if (!row.planKey) return { ok: false, reason: 'NOT_IN_PLAN', message: 'SMS tarifingizga kiritilmagan' };
    const eskiz = process.env.ESKIZ_API_TOKEN?.trim();
    const playmobile = process.env.PLAYMOBILE_API_TOKEN?.trim();
    if (!eskiz && playmobile) {
      return { ok: true, provider: 'playmobile', token: playmobile, sender: process.env.PLAYMOBILE_ORIGINATOR?.trim() || row.smsSender || '4546', configured: true, platformAccount: true };
    }
    return { ok: true, provider: 'eskiz', token: eskiz || undefined, sender: process.env.ESKIZ_SENDER?.trim() || row.smsSender || '4546', configured: Boolean(eskiz), platformAccount: true };
  }

  /**
   * Takes the right to send the SMS with this key, or says why not:
   * DUPLICATE - sent already, being sent, or timed out (may have gone);
   * QUOTA - the platform account's monthly budget (PLATFORM_SMS_PER_CENTER_MONTH
   * per center, PLATFORM_SMS_PER_MONTH in all; 0 = no total cap) is used up.
   * A message the provider clearly refused may try again (3 attempts in all)
   * and gives its place in the budget back. One lock per month: two sends at
   * once cannot both take the last place.
   */
  private async reserveSms(tenantId: string, key: string, platformAccount: boolean): Promise<'GO' | 'DUPLICATE' | 'QUOTA'> {
    const { month, perCenter, total } = smsBudget();
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sms-send:${month}`}))`);
      const [existing] = await tx.select().from(smsSends).where(and(eq(smsSends.tenantId, tenantId), eq(smsSends.idempotencyKey, key)));
      if (existing && (existing.status !== 'FAILED' || existing.attempts >= 3)) return 'DUPLICATE';
      if (platformAccount) {
        const counted = and(eq(smsSends.month, month), eq(smsSends.platformAccount, true), inArray(smsSends.status, SMS_COUNTED));
        const [{ mine }] = await tx.select({ mine: sql<number>`count(*)::int` }).from(smsSends).where(and(counted, eq(smsSends.tenantId, tenantId)));
        if (mine >= perCenter) return 'QUOTA';
        if (total > 0) {
          const [{ all }] = await tx.select({ all: sql<number>`count(*)::int` }).from(smsSends).where(counted);
          if (all >= total) return 'QUOTA';
        }
      }
      if (existing) {
        await tx.update(smsSends).set({ status: 'RESERVED', attempts: existing.attempts + 1, month, platformAccount, updatedAt: new Date() }).where(eq(smsSends.id, existing.id));
      } else {
        await tx.insert(smsSends).values({ tenantId, idempotencyKey: key, month, platformAccount });
      }
      return 'GO';
    });
  }

  private async settleSms(tenantId: string, key: string, status: 'SENT' | 'FAILED' | 'UNKNOWN') {
    await this.db.update(smsSends).set({ status, updatedAt: new Date() }).where(and(eq(smsSends.tenantId, tenantId), eq(smsSends.idempotencyKey, key)));
  }

  async getSettings(tenantId: string) {
    const tenant = await this.db.query.tenants.findFirst({
      where: eq(tenants.id, tenantId),
      columns: {
        id: true,
        smsEnabled: true,
        notifyOnAttendance: true,
        notifyOnPayment: true,
        notifyOnHomework: true,
        remindPaymentDay: true,
        remindLessons: true,
        dailyDigest: true,
        absenceStreakAlert: true,
        trialFollowUpDays: true,
        remindAttendance: true,
        autoInvoices: true,
      },
    });
    if (!tenant) throw new NotFoundException('Markaz topilmadi');
    const route = await this.smsRoute(tenantId);
    // This month on the platform's account: used of the center's budget.
    let budget: { month: string; used: number; limit: number } | null = null;
    if (route.ok && route.platformAccount) {
      const { month, perCenter } = smsBudget();
      const [{ used }] = await this.db
        .select({ used: sql<number>`count(*)::int` })
        .from(smsSends)
        .where(and(eq(smsSends.tenantId, tenantId), eq(smsSends.month, month), eq(smsSends.platformAccount, true), inArray(smsSends.status, SMS_COUNTED)));
      budget = { month, used, limit: perCenter };
    }
    // Field by field: what the settings screen shows, never a provider or token.
    return {
      id: tenant.id,
      smsEnabled: tenant.smsEnabled,
      notifyOnAttendance: tenant.notifyOnAttendance,
      notifyOnPayment: tenant.notifyOnPayment,
      notifyOnHomework: tenant.notifyOnHomework,
      remindPaymentDay: tenant.remindPaymentDay,
      remindLessons: tenant.remindLessons,
      dailyDigest: tenant.dailyDigest,
      absenceStreakAlert: tenant.absenceStreakAlert,
      trialFollowUpDays: tenant.trialFollowUpDays,
      remindAttendance: tenant.remindAttendance,
      autoInvoices: tenant.autoInvoices,
      sms: {
        includedInPlan: route.ok || route.reason !== 'NOT_IN_PLAN',
        enabled: tenant.smsEnabled,
        providerReady: route.ok ? route.configured : null,
        budget,
      },
    };
  }

  async updateSettings(tenantId: string, dto: UpdateNotificationSettingsDto) {
    const patch: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (dto.smsEnabled !== undefined) patch.smsEnabled = dto.smsEnabled;
    if (dto.notifyOnAttendance !== undefined) patch.notifyOnAttendance = dto.notifyOnAttendance;
    if (dto.notifyOnPayment !== undefined) patch.notifyOnPayment = dto.notifyOnPayment;
    if (dto.notifyOnHomework !== undefined) patch.notifyOnHomework = dto.notifyOnHomework;
    if (dto.remindPaymentDay !== undefined) patch.remindPaymentDay = dto.remindPaymentDay;
    if (dto.remindLessons !== undefined) patch.remindLessons = dto.remindLessons;
    if (dto.dailyDigest !== undefined) patch.dailyDigest = dto.dailyDigest;
    if (dto.absenceStreakAlert !== undefined) patch.absenceStreakAlert = dto.absenceStreakAlert;
    if (dto.trialFollowUpDays !== undefined) patch.trialFollowUpDays = dto.trialFollowUpDays;
    if (dto.remindAttendance !== undefined) patch.remindAttendance = dto.remindAttendance;
    if (dto.autoInvoices !== undefined) patch.autoInvoices = dto.autoInvoices;

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

    if (dto.channel === 'TELEGRAM' && !(await flagOn(this.db, 'telegram', tenantId))) {
      status = 'FAILED';
      errorMessage = "Telegram xabarlari vaqtincha o'chirilgan";
      providerName = 'telegram';
    } else if (dto.channel === 'TELEGRAM') {
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
      const route = await this.smsRoute(tenantId);
      const key = dto.idempotencyKey || createId();
      const reserved = route.ok ? await this.reserveSms(tenantId, key, route.platformAccount) : null;
      if (!route.ok) {
        status = 'FAILED';
        errorMessage = route.message;
      } else if (reserved === 'QUOTA') {
        status = 'FAILED';
        errorMessage = "SMS_QUOTA: oylik SMS limiti tugagan";
      } else if (reserved === 'DUPLICATE') {
        status = 'FAILED';
        errorMessage = "SMS_DUPLICATE: bu xabar allaqachon yuborilgan yoki yuborilmoqda";
      } else {
        const provider = route.provider === 'playmobile' ? this.playmobile : this.eskiz;
        providerName = provider.name;
        const result = await provider.sendSms(dto.recipient, dto.content, { sender: route.sender, apiToken: route.token });
        if (!result.success) {
          status = 'FAILED';
          errorMessage = result.error || 'SMS delivery failed';
          await this.settleSms(tenantId, key, result.uncertain ? 'UNKNOWN' : 'FAILED');
        } else {
          providerMessageId = result.messageId || null;
          await this.settleSms(tenantId, key, 'SENT');
        }
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
    const tenant = await this.db.query.tenants.findFirst({ where: eq(tenants.id, tenantId), columns: { name: true } });
    const route = await this.smsRoute(tenantId);
    return {
      centerName: tenant?.name ?? 'TalimCRM',
      // Only when the plan includes SMS and the center has it on. Outside
      // production an SMS without a token is only logged (sandbox), which is
      // what local runs and tests want; in production it needs one.
      sms: route.ok && (route.configured || process.env.NODE_ENV !== 'production'),
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
        void this.send(tenantId, { channel: 'SMS', event: 'PAYMENT_DUE', recipient: (st.parentPhone || st.phone)!, studentId: st.id, content: text, idempotencyKey: `DEBT:${claimed.id}` });
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
