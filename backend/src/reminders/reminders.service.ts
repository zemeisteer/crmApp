import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { enrollments, groups, reminderLog, students, teachers, tenants, users } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedParts } from '../common/timezone';
import { runsOn } from '../common/weekdays';

// Automatic reminders, run every few minutes by RemindersScanner:
//  - lessons: a Telegram message to students and the teacher ~2 hours before
//    today's lesson;
//  - payments: from the center's "reminder day" of the month, debtors (same
//    rule as the payments page) get Telegram + SMS, once per month.
// Nothing is sent at night (07:00-21:00 in the center's time zone), and
// reminder_log makes every reminder go out once, across restarts.

export const LESSON_LEAD_MINUTES = 120;
const DAY_START = 7;
const DAY_END = 21;

type Tenant = typeof tenants.$inferSelect;
const pad = (n: number) => String(n).padStart(2, '0');
const money = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly payments: PaymentsService,
  ) {}

  // One pass over every live center. `now` is injectable for tests.
  async scan(now = new Date()) {
    const list = await this.db.select().from(tenants).where(ne(tenants.status, 'SUSPENDED'));
    const out = { lessons: 0, payments: 0 };
    for (const t of list) {
      try {
        out.lessons += await this.lessonReminders(t, now);
        out.payments += await this.paymentReminders(t, now);
      } catch (err) {
        this.logger.warn(`Reminders for tenant ${t.id} failed: ${(err as Error).message}`);
      }
    }
    return out;
  }

  // True the first time only: the unique index turns repeats into no-ops.
  private async once(tenantId: string, kind: string, targetId: string, key: string) {
    const rows = await this.db
      .insert(reminderLog)
      .values({ tenantId, kind, targetId, key })
      .onConflictDoNothing()
      .returning({ id: reminderLog.id });
    return rows.length > 0;
  }

  private clock(t: Tenant, now: Date) {
    const tz = isValidTimeZone(t.timezone) ? t.timezone : DEFAULT_TIMEZONE;
    const p = zonedParts(now, tz);
    return {
      date: `${p.year}-${pad(p.month)}-${pad(p.day)}`,
      month: `${p.year}-${pad(p.month)}`,
      day: p.day,
      hour: p.hour,
      minutes: p.hour * 60 + p.minute,
      weekday: p.weekday,
      daytime: p.hour >= DAY_START && p.hour < DAY_END,
    };
  }

  async lessonReminders(t: Tenant, now: Date) {
    if (!t.remindLessons) return 0;
    const c = this.clock(t, now);
    if (!c.daytime) return 0;

    const todays = (
      await this.db
        .select({ id: groups.id, name: groups.name, startTime: groups.startTime, scheduleDays: groups.scheduleDays, teacherId: groups.teacherId })
        .from(groups)
        .where(and(eq(groups.tenantId, t.id), eq(groups.status, 'ACTIVE'), isNull(groups.deletedAt)))
    ).filter((g) => {
      if (!g.startTime || !runsOn(g.scheduleDays, c.weekday)) return false;
      const [h, m] = g.startTime.split(':').map(Number);
      const until = h * 60 + m - c.minutes;
      return until > 0 && until <= LESSON_LEAD_MINUTES;
    });
    if (todays.length === 0) return 0;

    let sent = 0;
    for (const g of todays) {
      const key = `${c.date}:${g.id}`;
      const time = g.startTime!.slice(0, 5);
      const kids = await this.db
        .select({ id: students.id, chat: students.telegramChatId })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(and(eq(enrollments.groupId, g.id), eq(enrollments.status, 'ACTIVE'), eq(students.status, 'ACTIVE'), isNull(students.deletedAt)));
      for (const k of kids) {
        if (!k.chat || !(await this.once(t.id, 'LESSON', k.id, key))) continue;
        await this.notifications.send(t.id, {
          channel: 'TELEGRAM',
          event: 'LESSON_REMINDER',
          recipient: k.chat,
          studentId: k.id,
          content: `⏰ Eslatma: bugun soat <b>${time}</b> da "${escape(g.name)}" darsi bor. Kechikmang!`,
        });
        sent++;
      }
      if (g.teacherId) {
        const [tch] = await this.db
          .select({ userId: users.id, chat: users.telegramChatId })
          .from(teachers)
          .innerJoin(users, eq(users.id, teachers.userId))
          .where(and(eq(teachers.id, g.teacherId), isNull(teachers.deletedAt)));
        if (tch?.chat && (await this.once(t.id, 'LESSON_TEACHER', tch.userId, key))) {
          await this.notifications.send(t.id, {
            channel: 'TELEGRAM',
            event: 'LESSON_REMINDER',
            recipient: tch.chat,
            content: `📅 Bugun soat <b>${time}</b> da "${escape(g.name)}" darsi (${kids.length} o'quvchi). Davomatni belgilashni unutmang.`,
          });
          sent++;
        }
      }
    }
    return sent;
  }

  async paymentReminders(t: Tenant, now: Date) {
    if (!t.remindPaymentDay || t.remindPaymentDay <= 0) return 0;
    const c = this.clock(t, now);
    // From the reminder day on (catches up after downtime), office hours only.
    if (c.day < t.remindPaymentDay || c.hour < 10 || c.hour >= 20) return 0;

    const debt = await this.payments.getDebtors(t.id, c.month, true);
    const due = debt.debtors.filter((d) => d.debtAmount > 0);
    if (due.length === 0) return 0;
    const chats = new Map(
      (
        await this.db
          .select({ id: students.id, chat: students.telegramChatId })
          .from(students)
          .where(and(eq(students.tenantId, t.id), inArray(students.id, due.map((d) => d.studentId))))
      ).map((r) => [r.id, r.chat]),
    );
    const sms = this.smsConfigured(t);

    let sent = 0;
    for (const d of due) {
      if (!(await this.once(t.id, 'PAYMENT', d.studentId, c.month))) continue;
      const text = `Hurmatli ota-ona / o'quvchi! ${d.studentName} uchun ${c.month} oyi to'lovi: ${money(d.debtAmount)} so'm. Iltimos, o'z vaqtida to'lang. ${t.name}`;
      const chat = chats.get(d.studentId);
      if (chat) {
        await this.notifications.send(t.id, { channel: 'TELEGRAM', event: 'PAYMENT_DUE', recipient: chat, studentId: d.studentId, content: escape(text) });
      }
      const phone = d.parentPhone || d.phone;
      if (sms && phone) {
        await this.notifications.send(t.id, { channel: 'SMS', event: 'PAYMENT_DUE', recipient: phone, studentId: d.studentId, content: text });
      }
      sent++;
    }
    return sent;
  }

  // SMS only with a real provider token: without one the provider "sends" a
  // mock and would log it as delivered.
  private smsConfigured(t: Tenant) {
    if (t.smsApiToken) return true;
    return t.smsProvider === 'playmobile' ? Boolean(this.config.get('PLAYMOBILE_API_TOKEN')) : Boolean(this.config.get('ESKIZ_API_TOKEN'));
  }
}

function escape(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
