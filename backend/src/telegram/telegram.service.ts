import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sum } from 'drizzle-orm';
import { randomBytes, timingSafeEqual } from 'crypto';
import * as qrcode from 'qrcode';
import { DB, Database } from '../db/db.module';
import {
  announcements,
  attendance,
  enrollments,
  examResults,
  groups,
  homework,
  homeworkCompletions,
  leadTrials,
  leads,
  organizationMemberships,
  payments,
  students,
  teachers,
  telegramLinkTokens,
  telegramParentChats,
  tenants,
  users,
} from '../db/schema';
import { DEFAULT_TIMEZONE, isValidTimeZone, zonedDayBounds, zonedParts } from '../common/timezone';
import { StudentTutorService, type TutorStudent } from '../ai/student-tutor.service';
import { tutorReplyHtml } from '../ai/tutor-prompt';

// Students' AI tutor: the button opens a conversation; every message goes
// to the AI until the student returns to the menu (or 30 minutes pass).
const AI_BUTTON = '🤖 AI ustoz';
const AI_EXIT = '⬅️ Menyu';
const AI_RESET = '🧹 Yangi suhbat';
const AI_KEYBOARD = { keyboard: [[{ text: AI_RESET }, { text: AI_EXIT }]], resize_keyboard: true };
const AI_IDLE_MS = 30 * 60 * 1000;
const AI_THINKING = "🤔 O'ylayapman...";

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: AI_BUTTON }],
    [{ text: '📅 Dars jadvali' }, { text: '📝 Uy vazifalar' }],
    [{ text: "💳 Balans va to'lov" }, { text: '📊 Davomat' }],
    [{ text: '🎯 Imtihonlar' }, { text: "📢 E'lonlar" }],
    [{ text: '🪪 Mening QR-kodim' }, { text: 'ℹ️ Markaz haqida' }],
  ],
  resize_keyboard: true,
};

// Parents: the child's information, no AI tutor or student QR card.
const CHILDREN_BUTTON = '👨‍👩‍👧 Farzandlarim';
const PARENT_KEYBOARD = {
  keyboard: [
    [{ text: '📅 Dars jadvali' }, { text: '📊 Davomat' }],
    [{ text: "💳 Balans va to'lov" }, { text: '📝 Uy vazifalar' }],
    [{ text: '🎯 Imtihonlar' }, { text: "📢 E'lonlar" }],
    [{ text: CHILDREN_BUTTON }],
  ],
  resize_keyboard: true,
};

// Center staff (owner, admin, manager, reception, accountant) get CRM
// buttons, teachers their own lessons; never the student cabinet.
const STAFF_KEYBOARD = {
  keyboard: [
    [{ text: '📊 Bugungi holat' }, { text: '🆕 Yangi arizalar' }],
    [{ text: '📞 Qayta aloqa' }, { text: '🎓 Sinov darslari' }],
    [{ text: '📈 Kun yakuni' }, { text: '❓ Yordam' }],
  ],
  resize_keyboard: true,
};

const TEACHER_KEYBOARD = {
  keyboard: [[{ text: '📅 Bugungi darslarim' }], [{ text: '📝 Vazifalar' }, { text: '💰 Maoshim' }], [{ text: '❓ Yordam' }]],
  resize_keyboard: true,
};

const WEEKDAY_CODES: Record<number, string[]> = {
  1: ['mon', 'dushanba', 'du'],
  2: ['tue', 'seshanba', 'se'],
  3: ['wed', 'chorshanba', 'chor'],
  4: ['thu', 'payshanba', 'pay'],
  5: ['fri', 'juma'],
  6: ['sat', 'shanba'],
  7: ['sun', 'yakshanba'],
};

const SOURCE_LABEL: Record<string, string> = {
  INSTAGRAM: 'Instagram', TELEGRAM: 'Telegram', WEBSITE: 'Sayt', REFERRAL: 'Tavsiya',
  WALK_IN: "O'zi keldi", PHONE: "Qo'ng'iroq", ADVERTISEMENT: 'Reklama', OTHER: 'Boshqa',
};

type AttendanceMark = 'PRESENT' | 'ABSENT' | 'LATE';
type AttendanceSheet = { tenantId: string; groupId: string; groupName: string; date: string; people: Array<{ id: string; name: string; status: AttendanceMark }> };
const MARK_ICON: Record<AttendanceMark, string> = { PRESENT: '✅', ABSENT: '❌', LATE: '⏰' };
const NEXT_MARK: Record<AttendanceMark, AttendanceMark> = { PRESENT: 'ABSENT', ABSENT: 'LATE', LATE: 'PRESENT' };

type MenuStudent = typeof students.$inferSelect & { tenant: typeof tenants.$inferSelect | null };

type StaffUser = { id: string; fullName: string; tenantId: string | null; role: string };


// Messages use parse_mode HTML; names come from user input.
function escapeHtml(v: string) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly tutor: StudentTutorService,
    private readonly moduleRef: ModuleRef,
  ) {}

  // Attendance sheets open in teachers' chats: "<chatId>:<groupId>" -> marks
  // (saved only on "Save", so a mis-tap never messages parents).
  private readonly sheets = new Map<string, AttendanceSheet>();

  // chatId -> when the AI tutor conversation lapses (in memory: a restart
  // just returns the student to the menu).
  private readonly tutorUntil = new Map<string, number>();

  private async sendTyping(chatId: string) {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    }).catch(() => undefined);
  }

  private async startTutor(chatId: string, student: TutorStudent) {
    const quota = await this.tutor.quota(student);
    if (quota.limit <= 0) {
      await this.sendMessage(chatId, "🤖 AI ustoz markazingizda hozircha yoqilmagan.", MAIN_KEYBOARD);
      return;
    }
    if (!this.tutor.available) {
      await this.sendMessage(chatId, "🤖 AI ustoz hozircha ishlamayapti. Keyinroq urinib ko'ring.", MAIN_KEYBOARD);
      return;
    }
    this.tutorUntil.set(chatId, Date.now() + AI_IDLE_MS);
    const first = escapeHtml(student.fullName.split(' ')[0] || student.fullName);
    await this.sendMessage(
      chatId,
      `🤖 <b>AI ustoz</b>\n\nSalom, ${first}! Darsdagi tushunmagan mavzu, qoida yoki masalani yozing — qadamma-qadam tushuntirib beraman.\n\n` +
        `Masalan: <i>"Present Perfect qachon ishlatiladi?"</i> yoki <i>"2x + 5 = 17 ni qanday yechaman?"</i>\n\n` +
        `📌 Bugun ${quota.left} ta savol berishingiz mumkin. Savollaringizni markaz ustozlari ko'rishi mumkin.\nMenyuga qaytish uchun "${AI_EXIT}" ni bosing.`,
      AI_KEYBOARD,
    );
  }

  // The student sees "thinking..." at once; that message then turns into the
  // answer (editMessageText), so the chat has no stray placeholder. The same
  // path serves a new question and the student's answer to the tutor's own
  // question: both are free text in an open conversation.
  private async askTutor(chatId: string, student: TutorStudent, text: string) {
    this.tutorUntil.set(chatId, Date.now() + AI_IDLE_MS);
    const placeholderId = await this.sendMessage(chatId, AI_THINKING);
    await this.sendTyping(chatId);
    const res = await this.tutor.ask(student, text);
    // Edits keep the reply keyboard already on screen; replies that must
    // swap it (back to the main menu) are sent anew instead.
    const reply = async (msg: string, keyboard: typeof AI_KEYBOARD | typeof MAIN_KEYBOARD) => {
      if (placeholderId && keyboard === AI_KEYBOARD && (await this.editMessage(chatId, placeholderId, msg))) return;
      if (placeholderId) await this.deleteMessage(chatId, placeholderId);
      await this.sendMessage(chatId, msg, keyboard);
    };
    switch (res.status) {
      case 'ok': {
        const footer = res.left <= 5 ? `\n\n<i>Bugun yana ${res.left} ta savol berishingiz mumkin.</i>` : '';
        await reply(tutorReplyHtml(res.reply) + footer, AI_KEYBOARD);
        return;
      }
      case 'off':
        this.tutorUntil.delete(chatId);
        await reply("🤖 AI ustoz markazingizda hozircha yoqilmagan.", MAIN_KEYBOARD);
        return;
      case 'unavailable':
        this.tutorUntil.delete(chatId);
        await reply("🤖 AI ustoz hozircha ishlamayapti. Keyinroq urinib ko'ring.", MAIN_KEYBOARD);
        return;
      case 'limit':
        await reply(`⏳ Bugungi ${res.limit} ta savol limiti tugadi. Ertaga yana yozing — yoki savolingizni darsda ustozingizga bering.`, AI_KEYBOARD);
        return;
      default:
        await reply("😕 Hozir javob bera olmadim. Birozdan keyin qayta yozib ko'ring.", AI_KEYBOARD);
    }
  }

  private get token() {
    return this.config.get<string>('TELEGRAM_BOT_TOKEN');
  }

  get isConfigured() {
    return Boolean(this.token);
  }

  get botUsername() {
    return this.config.get<string>('TELEGRAM_BOT_USERNAME') || null;
  }

  // Generates a cryptographically secure, 15-minute single-use linking token.
  // Master Spec Section 32: Raw student IDs must NEVER be used directly in deep links.
  async generateLinkToken(tenantId: string, studentId: string, purpose: 'STUDENT' | 'PARENT' = 'STUDENT') {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min TTL

    await this.db.insert(telegramLinkTokens).values({
      tenantId,
      studentId,
      purpose,
      token,
      expiresAt,
    });

    const linkUrl = this.botUsername
      ? `https://t.me/${this.botUsername}?start=${purpose === 'PARENT' ? 'parent' : 'link'}_${token}`
      : null;

    return {
      token,
      linkUrl,
      expiresAt: expiresAt.toISOString(),
      studentName: student.fullName,
    };
  }

  linkUrl(studentId: string) {
    if (!this.botUsername) return null;
    return `https://t.me/${this.botUsername}?start=${studentId}`;
  }

  // ==================== STAFF (CRM reminders) ====================

  // Telegram sends this secret in X-Telegram-Bot-Api-Secret-Token when the
  // webhook was registered with secret_token. Without it anyone could post
  // forged updates to the public webhook URL.
  isValidWebhookSecret(header: string | undefined) {
    const secret = this.config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    // Production must set a secret: otherwise anyone could post fake updates.
    if (!secret) return process.env.NODE_ENV !== 'production';
    if (!header) return false;
    const a = Buffer.from(header);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async staffStatus(userId: string) {
    const [u] = await this.db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, userId));
    return { configured: this.isConfigured && Boolean(this.botUsername), botUsername: this.botUsername, linked: Boolean(u?.chat) };
  }

  // One-time, 15-minute deep link that connects the caller's own Telegram
  // chat to their user account.
  async generateStaffLinkToken(tenantId: string, userId: string) {
    const token = randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await this.db.insert(telegramLinkTokens).values({ tenantId, userId, token, expiresAt });
    return {
      linkUrl: this.botUsername ? `https://t.me/${this.botUsername}?start=staff_${token}` : null,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async unlinkStaff(userId: string) {
    await this.db.update(users).set({ telegramChatId: null }).where(eq(users.id, userId));
    return { linked: false };
  }

  // Sends a CRM notice to a staff member if they linked Telegram. Returns
  // whether a message was sent.
  async notifyUser(userId: string, text: string) {
    if (!this.token) return false;
    const [u] = await this.db.select({ chat: users.telegramChatId }).from(users).where(eq(users.id, userId));
    if (!u?.chat) return false;
    await this.sendMessage(u.chat, text);
    return true;
  }

  private async linkStaffChat(chatId: string, token: string) {
    const linkRecord = await this.db.query.telegramLinkTokens.findFirst({
      where: and(
        eq(telegramLinkTokens.token, token),
        isNull(telegramLinkTokens.usedAt),
        gt(telegramLinkTokens.expiresAt, new Date()),
        isNotNull(telegramLinkTokens.userId),
      ),
      with: { user: { columns: { id: true, fullName: true } } },
    });
    if (!linkRecord?.user) {
      await this.sendMessage(chatId, "❌ Havola noto'g'ri, muddati (15 daqiqa) o'tgan yoki oldin ishlatilgan.\n\nCRM'dan yangi havola oling.");
      return;
    }
    // Consume first (single use), then attach this chat to the user only;
    // a chat can belong to one staff account at a time.
    const [claimed] = await this.db.update(telegramLinkTokens).set({ usedAt: new Date() })
      .where(and(eq(telegramLinkTokens.id, linkRecord.id), isNull(telegramLinkTokens.usedAt)))
      .returning({ id: telegramLinkTokens.id });
    if (!claimed) return;
    await this.db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
    // A chat belongs to one account: if this Telegram was linked to a
    // student before (e.g. while testing), that link is dropped so the bot
    // stops answering with the student cabinet.
    await this.db.update(students).set({ telegramChatId: null }).where(eq(students.telegramChatId, chatId));
    await this.db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, linkRecord.user.id));
    const staff = await this.findStaff(chatId);
    const teacher = staff?.role === 'TEACHER';
    await this.sendMessage(
      chatId,
      `✅ <b>${escapeHtml(linkRecord.user.fullName)}</b>, Telegram hisobingiz TalimCRM'ga ${teacher ? "o'qituvchi" : 'markaz xodimi'} sifatida ulandi.\n\n` +
        (teacher
          ? "Pastdagi tugma orqali bugungi darslaringizni ko'rasiz."
          : "Endi yangi arizalar, qayta aloqa va sinov darslari haqidagi eslatmalar shu yerga keladi. Pastdagi tugmalar orqali markaz holatini ko'rasiz."),
      teacher ? TEACHER_KEYBOARD : STAFF_KEYBOARD,
    );
  }

  // The staff account linked to this chat, with its role in its center.
  private async findStaff(chatId: string): Promise<StaffUser | null> {
    const u = await this.db.query.users.findFirst({
      where: eq(users.telegramChatId, chatId),
      columns: { id: true, fullName: true, tenantId: true, role: true },
    });
    if (!u || !u.tenantId) return null;
    // Only while they are an active member of that center: a removed or
    // suspended member's chat gets nothing.
    const [m] = await this.db
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(and(eq(organizationMemberships.userId, u.id), eq(organizationMemberships.tenantId, u.tenantId), eq(organizationMemberships.status, 'ACTIVE')));
    return m ? { ...u, role: m.role } : null;
  }

  private async tenantZone(tenantId: string) {
    const [t] = await this.db.select({ name: tenants.name, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    return { name: t?.name ?? 'Markaz', tz: isValidTimeZone(t?.timezone) ? t!.timezone! : DEFAULT_TIMEZONE };
  }

  private fmtTime(d: Date, tz: string) {
    const p = zonedParts(d, tz);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(p.day)}.${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
  }

  // Replies for a linked staff member. Returns after sending one message.
  private async handleStaffText(chatId: string, staff: StaffUser, text: string) {
    const teacher = staff.role === 'TEACHER';
    const keyboard = teacher ? TEACHER_KEYBOARD : STAFF_KEYBOARD;
    const lower = text.toLowerCase();
    if (!staff.tenantId) {
      await this.sendMessage(chatId, "Hisobingiz hech qaysi markazga biriktirilmagan.", keyboard);
      return;
    }
    const tenantId = staff.tenantId;
    const { name, tz } = await this.tenantZone(tenantId);
    const now = new Date();
    const { startOfToday, endOfToday } = zonedDayBounds(now, tz);

    if (teacher || lower.includes('darslarim')) {
      if (lower.includes('darslarim') || lower === '/today') {
        const weekday = zonedParts(now, tz).weekday;
        const rows = await this.db
          .select({ id: groups.id, name: groups.name, subject: groups.subject, days: groups.scheduleDays, start: groups.startTime, end: groups.endTime })
          .from(groups)
          .innerJoin(teachers, eq(teachers.id, groups.teacherId))
          .where(and(eq(groups.tenantId, tenantId), eq(teachers.userId, staff.id), isNull(groups.deletedAt), eq(groups.status, 'ACTIVE')))
          .orderBy(asc(groups.startTime));
        const today = rows.filter((g) =>
          (g.days ?? '').toLowerCase().split(/[,\s/]+/).some((d) => WEEKDAY_CODES[weekday].includes(d.trim())),
        );
        const msg = today.length
          ? `📅 <b>Bugungi darslaringiz</b>\n\n` +
            today.map((g) => `• <b>${escapeHtml(g.name)}</b> (${escapeHtml(g.subject)}) — ${g.start ?? '—'}${g.end ? `–${g.end}` : ''}`).join('\n') +
            `\n\nDavomat qilish uchun guruhni bosing 👇`
          : "📅 Bugun sizda dars yo'q.";
        // Inline buttons open an attendance sheet for that lesson.
        const markup = today.length
          ? { inline_keyboard: today.map((g) => [{ text: `📋 Davomat: ${g.name}${g.start ? ` (${g.start})` : ''}`, callback_data: `ag:${g.id}` }]) }
          : keyboard;
        await this.sendMessage(chatId, msg, markup);
        return;
      }
    }

    if (teacher && (lower.includes('vazifa') || lower === '/homework')) {
      await this.teacherHomework(chatId, staff, tenantId, keyboard);
      return;
    }

    if (teacher && (lower.includes('maosh') || lower === '/salary')) {
      const { SalaryService } = await import('../salary/salary.service');
      const salary = this.moduleRef.get(SalaryService, { strict: false });
      const p = zonedParts(now, tz);
      const month = `${p.year}-${String(p.month).padStart(2, '0')}`;
      const prevDate = new Date(Date.UTC(p.year, p.month - 2, 1));
      const prev = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;
      const [cur, last] = await Promise.all([salary.forTeacherUser(tenantId, staff.id, month), salary.forTeacherUser(tenantId, staff.id, prev)]);
      if (!cur && !last) {
        await this.sendMessage(chatId, "💰 Maosh ma'lumoti topilmadi. Markaz sizni o'qituvchilar ro'yxatiga bog'lashi kerak.", keyboard);
        return;
      }
      const money = (n: number) => new Intl.NumberFormat('uz-UZ').format(Math.round(n));
      const line = (label: string, it: typeof cur) =>
        it
          ? `<b>${label}</b>\n` +
            `• Hisoblangan: ${money(it.calculatedSalary)} so'm` +
            (it.details.deduction ? ` (ushlab qolindi: ${money(it.details.deduction)})` : '') +
            `\n• Darslar: ${it.details.lessonCount ?? it.details.plannedLessons ?? 0}` +
            (it.details.absentLessons ? ` · qoldirilgan: ${it.details.absentLessons}` : '') +
            `\n• ${it.isPaid ? `✅ To'langan: ${money(it.paidAmount)} so'm` : `⏳ To'lanmagan${it.paidAmount ? ` (qisman: ${money(it.paidAmount)})` : ''}`}`
          : `<b>${label}</b>\n• —`;
      await this.sendMessage(chatId, `💰 <b>Maoshingiz</b>\n\n${line(`${month} (joriy oy, hozircha)`, cur)}\n\n${line(prev, last)}`, keyboard);
      return;
    }

    if (!teacher && (lower.includes('kun yakuni') || lower === '/digest')) {
      // Loaded lazily: RemindersModule depends on this module.
      const { RemindersService } = await import('../reminders/reminders.service');
      const [t] = await this.db.select().from(tenants).where(eq(tenants.id, tenantId));
      const text = t ? await this.moduleRef.get(RemindersService, { strict: false }).digestText(t) : 'Markaz topilmadi';
      await this.sendMessage(chatId, text, keyboard);
      return;
    }

    if (!teacher && (lower.includes('holat') || lower === '/stats')) {
      const [[newToday], [open], [paid], [trials]] = await Promise.all([
        this.db.select({ n: count() }).from(leads)
          .where(and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt), gte(leads.createdAt, startOfToday), lt(leads.createdAt, endOfToday))),
        this.db.select({ n: count() }).from(leads)
          .where(and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt), inArray(leads.status, ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'QUALIFIED']))),
        this.db.select({ n: count(), total: sum(payments.amount) }).from(payments)
          .where(and(eq(payments.tenantId, tenantId), eq(payments.status, 'PAID'), gte(payments.paidAt, startOfToday), lt(payments.paidAt, endOfToday))),
        this.db.select({ n: count() }).from(leadTrials)
          .where(and(eq(leadTrials.tenantId, tenantId), eq(leadTrials.status, 'BOOKED'), gte(leadTrials.scheduledAt, startOfToday), lt(leadTrials.scheduledAt, endOfToday))),
      ]);
      const money = Number(paid?.total ?? 0).toLocaleString('uz-UZ');
      await this.sendMessage(
        chatId,
        `📊 <b>${escapeHtml(name)} — bugun</b>\n\n` +
          `🆕 Yangi arizalar: <b>${newToday?.n ?? 0}</b>\n` +
          `🗂 Ochiq lidlar: <b>${open?.n ?? 0}</b>\n` +
          `🎓 Bugungi sinov darslari: <b>${trials?.n ?? 0}</b>\n` +
          `💰 Bugungi to'lovlar: <b>${paid?.n ?? 0}</b> ta, <b>${money}</b> so'm`,
        keyboard,
      );
      return;
    }

    if (!teacher && (lower.includes('ariza') || lower === '/leads')) {
      const rows = await this.db
        .select({ fullName: leads.fullName, phone: leads.phone, source: leads.source, createdAt: leads.createdAt })
        .from(leads)
        .where(and(eq(leads.tenantId, tenantId), isNull(leads.archivedAt), eq(leads.status, 'NEW')))
        .orderBy(desc(leads.createdAt))
        .limit(10);
      const msg = rows.length
        ? `🆕 <b>Yangi arizalar</b> (hali bog'lanilmagan)\n\n` +
          rows.map((l) => `• <b>${escapeHtml(l.fullName)}</b> — ${escapeHtml(l.phone)}\n   ${SOURCE_LABEL[l.source] ?? l.source} · ${this.fmtTime(l.createdAt, tz)}`).join('\n')
        : "✅ Bog'lanilmagan yangi ariza yo'q.";
      await this.sendMessage(chatId, msg, keyboard);
      return;
    }

    if (!teacher && (lower.includes('aloqa') || lower === '/followups')) {
      const rows = await this.db
        .select({ fullName: leads.fullName, phone: leads.phone, followUpAt: leads.followUpAt })
        .from(leads)
        .where(and(
          eq(leads.tenantId, tenantId), isNull(leads.archivedAt), lte(leads.followUpAt, endOfToday),
          inArray(leads.status, ['NEW', 'CONTACTED', 'TRIAL_BOOKED', 'TRIAL_ATTENDED', 'QUALIFIED']),
        ))
        .orderBy(asc(leads.followUpAt))
        .limit(15);
      const msg = rows.length
        ? `📞 <b>Bugun qayta aloqa qilinadiganlar</b>\n\n` +
          rows.map((l) => `• <b>${escapeHtml(l.fullName)}</b> — ${escapeHtml(l.phone)} · ${l.followUpAt ? this.fmtTime(l.followUpAt, tz) : ''}${l.followUpAt && l.followUpAt < startOfToday ? ' ⚠️ kechikkan' : ''}`).join('\n')
        : "✅ Bugun qayta aloqa qilinadigan lid yo'q.";
      await this.sendMessage(chatId, msg, keyboard);
      return;
    }

    if (!teacher && (lower.includes('sinov') || lower === '/trials')) {
      const weekAhead = new Date(endOfToday.getTime() + 6 * 86_400_000);
      const rows = await this.db
        .select({ at: leadTrials.scheduledAt, fullName: leads.fullName, phone: leads.phone, group: groups.name })
        .from(leadTrials)
        .innerJoin(leads, eq(leads.id, leadTrials.leadId))
        .leftJoin(groups, eq(groups.id, leadTrials.groupId))
        .where(and(eq(leadTrials.tenantId, tenantId), eq(leadTrials.status, 'BOOKED'), gte(leadTrials.scheduledAt, startOfToday), lt(leadTrials.scheduledAt, weekAhead)))
        .orderBy(asc(leadTrials.scheduledAt))
        .limit(15);
      const msg = rows.length
        ? `🎓 <b>Yaqin 7 kundagi sinov darslari</b>\n\n` +
          rows.map((r) => `• ${this.fmtTime(r.at, tz)} — <b>${escapeHtml(r.fullName)}</b> (${escapeHtml(r.phone)})${r.group ? ` · ${escapeHtml(r.group)}` : ''}`).join('\n')
        : "Yaqin 7 kunda sinov darsi yo'q.";
      await this.sendMessage(chatId, msg, keyboard);
      return;
    }

    await this.sendMessage(
      chatId,
      `Assalomu alaykum, <b>${escapeHtml(staff.fullName)}</b>! Bu chat <b>${escapeHtml(name)}</b> ${teacher ? "o'qituvchisi" : 'xodimi'} sifatida ulangan.\n\n` +
        (teacher
          ? "📅 Bugungi darslarim — bugungi guruhlar va davomat\n📝 Vazifalar — topshirilganlarni tekshirish va baholash\n💰 Maoshim — shu va o'tgan oy maoshi"
          : "📊 Bugungi holat — arizalar, sinov darslari va to'lovlar\n🆕 Yangi arizalar — hali bog'lanilmaganlar\n📞 Qayta aloqa — bugun qo'ng'iroq qilinadiganlar\n🎓 Sinov darslari — yaqin 7 kun\n📈 Kun yakuni — bugungi raqamlar") +
        `\n\nUlanishni o'chirish: CRM → Sozlamalar → Telegram eslatmalari.`,
      keyboard,
    );
  }

  // Resolves to the sent message's id (undefined when it was not sent).
  async sendMessage(chatId: string, text: string, replyMarkup?: any): Promise<number | undefined> {
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — skipping message send');
      return undefined;
    }
    try {
      const payload: any = {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }

      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.logger.error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
        return undefined;
      }
      const body = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
      return body?.result?.message_id;
    } catch (err) {
      this.logger.error(`Telegram sendMessage error: ${(err as Error).message}`);
      return undefined;
    }
  }

  async sendPhoto(chatId: string, photoBuffer: Buffer, caption?: string) {
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — skipping sendPhoto');
      return;
    }
    try {
      const formData = new FormData();
      formData.append('chat_id', chatId);
      const blob = new Blob([new Uint8Array(photoBuffer)], { type: 'image/png' });
      formData.append('photo', blob, 'qrcode.png');
      if (caption) {
        formData.append('caption', caption);
        formData.append('parse_mode', 'HTML');
      }

      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        this.logger.error(`Telegram sendPhoto failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`Telegram sendPhoto error: ${(err as Error).message}`);
    }
  }


  // The student's own chat and every linked parent's chat.
  async notifyStudent(studentId: string, text: string) {
    const student = await this.db.query.students.findFirst({ where: eq(students.id, studentId) });
    if (!student) return;
    const chats = new Set([student.telegramChatId, ...(await this.parentChatIds(studentId))].filter((c): c is string => Boolean(c)));
    for (const chat of chats) await this.sendMessage(chat, text);
  }

  async notifyGroup(tenantId: string, groupId: string, text: string) {
    const enrolled = await this.db.query.enrollments.findMany({
      where: eq(enrollments.groupId, groupId),
      with: { student: true },
    });
    for (const e of enrolled) {
      if (e.student?.telegramChatId) {
        void this.sendMessage(e.student.telegramChatId, text);
      }
    }
  }

  async notifyExamResult(
    studentId: string,
    examTitle: string,
    score: number,
    maxScore: number,
    note?: string,
  ) {
    const student = await this.db.query.students.findFirst({
      where: eq(students.id, studentId),
    });
    if (!student) return;

    const percentage = Math.round((score / (maxScore || 100)) * 100);
    let grade = 'B';
    if (percentage >= 90) grade = "A'lo (A+)";
    else if (percentage >= 80) grade = 'Yaxshi (A)';
    else if (percentage >= 70) grade = 'Qoniqarli (B)';
    else if (percentage >= 60) grade = 'Yetarli (C)';
    else grade = 'Qoniqarsiz (F)';

    const message = `🎯 <b>Imtihon natijangiz e'lon qilindi!</b>\n\n📌 <b>Imtihon:</b> ${examTitle}\n📊 <b>To'plagan ballingiz:</b> ${score} / ${maxScore} (${percentage}%)\n🏅 <b>Baholash:</b> ${grade}${note ? `\n💬 <b>Izoh:</b> ${note}` : ''}\n\n<i>TalimCRM tizimi orqali yuborildi.</i>`;

    // The student and their linked parents.
    await this.notifyStudent(studentId, message);
  }

  // Sends an announcement to everyone in its audience who has linked
  // Telegram: students (student bot link) and staff (CRM reminders link).
  // ALL reaches both; STUDENTS and TEACHERS only their side; GROUP the
  // group's students. Returns how many chats it was sent to.
  async broadcastAnnouncement(
    tenantId: string,
    title: string,
    content: string,
    priority: string = 'NORMAL',
    audience: string = 'ALL',
    targetGroupId?: string,
  ) {
    const priorityIcon =
      priority === 'URGENT' ? '🚨' : priority === 'HIGH' ? '⚡' : '📢';
    const priorityLabel =
      priority === 'URGENT'
        ? "SHOSHILINCH E'LON"
        : priority === 'HIGH'
          ? "MUHIM E'LON"
          : "YANGILIK / E'LON";

    const formattedMessage = `${priorityIcon} <b>${priorityLabel}: ${escapeHtml(title)}</b>\n\n${escapeHtml(content)}\n\n<i>TalimCRM tizimi orqali tarqatildi.</i>`;

    if (audience === 'GROUP' && targetGroupId) {
      await this.notifyGroup(tenantId, targetGroupId, formattedMessage);
      return;
    }

    const chats = new Set<string>();
    if (audience === 'ALL' || audience === 'STUDENTS') {
      const linkedStudents = await this.db.query.students.findMany({
        where: and(eq(students.tenantId, tenantId), isNull(students.deletedAt), isNotNull(students.telegramChatId)),
        columns: { telegramChatId: true },
      });
      for (const s of linkedStudents) if (s.telegramChatId) chats.add(s.telegramChatId);
    }
    if (audience === 'ALL' || audience === 'TEACHERS') {
      const staff = await this.db
        .select({ chat: users.telegramChatId })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(and(
          eq(organizationMemberships.tenantId, tenantId),
          eq(organizationMemberships.status, 'ACTIVE'),
          isNotNull(users.telegramChatId),
          ...(audience === 'TEACHERS' ? [eq(organizationMemberships.role, 'TEACHER')] : []),
        ));
      for (const s of staff) if (s.chat) chats.add(s.chat);
    }

    for (const chat of chats) {
      await this.sendMessage(chat, formattedMessage);
    }
    this.logger.log(`Announcement sent to ${chats.size} Telegram chat(s) (tenant ${tenantId}, audience ${audience})`);
  }

  // Handles Telegram webhook payload with interactive commands & account linking
  async handleUpdate(update: any) {
    if (update?.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    const message = update?.message;
    const text: string | undefined = message?.text?.trim();
    const chatId: string | undefined = message?.chat?.id?.toString();
    if (!text || !chatId) return;

    // 1. Check for /start command
    if (text.startsWith('/start')) {
      const rawPayload = text.replace('/start', '').trim();
      if (!rawPayload) {
        const staff = await this.findStaff(chatId);
        if (staff) {
          await this.handleStaffText(chatId, staff, '/start');
          return;
        }
        const child = await this.parentChild(chatId);
        if (child) {
          await this.sendMessage(chatId, `Assalomu alaykum! 👋\n\nFarzandingiz <b>${escapeHtml(child.fullName)}</b> haqidagi ma'lumotlar uchun tugmalardan foydalaning.`, PARENT_KEYBOARD);
          return;
        }
        const existingStudent = await this.db.query.students.findFirst({
          where: eq(students.telegramChatId, chatId),
        });
        if (existingStudent) {
          await this.sendMessage(
            chatId,
            `Assalomu alaykum, <b>${existingStudent.fullName}</b>! 👋\n\nTalimCRM o'quvchi kabinetiga xush kelibsiz. Kerakli ma'lumotni olish uchun quyidagi tugmalardan birini bosing:`,
            MAIN_KEYBOARD,
          );
          return;
        }

        await this.sendMessage(
          chatId,
          "Assalomu alaykum! TalimCRM rasmiy botiga xush kelibsiz.\n\nO'quvchi kabinetini ulash uchun markazingiz tomonidan berilgan maxsus havolani bosing.",
        );
        return;
      }

      if (rawPayload.startsWith('staff_')) {
        await this.linkStaffChat(chatId, rawPayload.replace('staff_', ''));
        return;
      }

      if (rawPayload.startsWith('parent_')) {
        await this.linkParentChat(chatId, rawPayload.replace('parent_', ''));
        return;
      }

      const token = rawPayload.startsWith('link_')
        ? rawPayload.replace('link_', '')
        : rawPayload;

      const linkRecord = await this.db.query.telegramLinkTokens.findFirst({
        where: and(
          eq(telegramLinkTokens.token, token),
          eq(telegramLinkTokens.purpose, 'STUDENT'),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, new Date()),
        ),
        with: { student: true },
      });

      if (!linkRecord || !linkRecord.student) {
        // Fallback check if legacy plain student ID was passed
        const legacyStudent = await this.db.query.students.findFirst({
          where: eq(students.id, rawPayload),
        });
        if (legacyStudent) {
          await this.sendMessage(
            chatId,
            "⚠️ Ushbu havola eskirgan yoki xavfsizlik talablariga mos emas. Iltimos, o'quvchi profilidan yangi xavfsiz bir martalik havola oling.",
          );
          return;
        }

        await this.sendMessage(
          chatId,
          "❌ Havola noto'g'ri, muddati (15 daqiqa) o'tgan yoki oldin ishlatilgan.\n\nIltimos, o'quvchi profilidan yangi havola oling.",
        );
        return;
      }

      // Mark token as consumed immediately (single-use guarantee)
      await this.db
        .update(telegramLinkTokens)
        .set({ usedAt: new Date() })
        .where(eq(telegramLinkTokens.id, linkRecord.id));

      // Link student's telegram chat ID (a chat belongs to one account, so
      // a staff link on the same chat is dropped).
      await this.db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
      await this.db
        .update(students)
        .set({ telegramChatId: chatId })
        .where(eq(students.id, linkRecord.studentId!));

      await this.sendMessage(
        chatId,
        `✅ Tabriklaymiz! Siz muvaffaqiyatli ravishda <b>${linkRecord.student.fullName}</b> uchun xabarnomalar va o'quvchi kabinetiga ulandingiz.`,
        MAIN_KEYBOARD,
      );
      return;
    }

    // 2. Staff chats get CRM buttons, never the student cabinet.
    const staffUser = await this.findStaff(chatId);
    if (staffUser) {
      await this.handleStaffText(chatId, staffUser, text);
      return;
    }

    // 3. Parents see their (chosen) child.
    const child = await this.parentChild(chatId);
    if (child) {
      await this.handleParentText(chatId, child, text);
      return;
    }

    // 4. Look up the student linked with this chat ID
    const student = await this.db.query.students.findFirst({
      where: eq(students.telegramChatId, chatId),
      with: {
        tenant: true,
      },
    });

    if (!student) {
      await this.sendMessage(
        chatId,
        "⚠️ Sizning Telegram akkauntingiz hali TalimCRM tizimidagi hech qaysi o'quvchiga ulanmagan.\n\nUlash uchun o'quv markazingizdan maxsus bir martalik havola oling.",
      );
      return;
    }

    // 3. AI tutor: its buttons, and free text while a conversation is open.
    if (text === AI_BUTTON || text === '/ai') {
      await this.startTutor(chatId, student);
      return;
    }
    if (text === AI_EXIT || text === '/menu') {
      this.tutorUntil.delete(chatId);
      await this.sendMessage(chatId, "Asosiy menyu. Kerakli bo'limni tanlang:", MAIN_KEYBOARD);
      return;
    }
    if (text === AI_RESET) {
      await this.tutor.reset(student);
      this.tutorUntil.set(chatId, Date.now() + AI_IDLE_MS);
      await this.sendMessage(chatId, "🧹 Yangi suhbat boshlandi. Savolingizni yozing!", AI_KEYBOARD);
      return;
    }
    const menuButton = MAIN_KEYBOARD.keyboard.some((row) => row.some((b) => b.text === text));
    if (menuButton || text.startsWith('/')) {
      this.tutorUntil.delete(chatId);
    } else if ((this.tutorUntil.get(chatId) ?? 0) > Date.now()) {
      await this.askTutor(chatId, student, text);
      return;
    }

    await this.studentMenu(chatId, student, text, MAIN_KEYBOARD, false);
  }

  // Menu answers about one student - for the student, or for a parent
  // (with the parent's keyboard).
  private async studentMenu(chatId: string, student: MenuStudent, text: string, kb: typeof MAIN_KEYBOARD, forParent: boolean) {
    const lower = text.toLowerCase();

    // 3A: Schedule
    if (lower.includes('dars') || lower.includes('jadval') || lower === '/schedule') {
      const enrolls = await this.db.query.enrollments.findMany({
        where: eq(enrollments.studentId, student.id),
        with: {
          group: {
            with: {
              teacher: true,
              branch: true,
            },
          },
        },
      });

      if (enrolls.length === 0) {
        await this.sendMessage(
          chatId,
          `📅 <b>Dars jadvali:</b>\n\n👤 O'quvchi: <b>${student.fullName}</b>\n\nSiz hozircha birorta faol guruhga biriktirilmagansiz.`,
          kb,
        );
        return;
      }

      let msg = `📅 <b>Sizning dars jadvalingiz:</b>\n👤 O'quvchi: <b>${student.fullName}</b>\n\n`;
      for (const e of enrolls) {
        const g = e.group;
        msg += `📌 <b>${g.name}</b> (${g.subject})\n`;
        msg += `🕒 <b>Vaqti:</b> ${g.startTime || '16:00'}\n`;
        msg += `🗓 <b>Kunlari:</b> ${g.scheduleDays || g.schedule || 'Dush, Chor, Juma'}\n`;
        if (g.teacher) msg += `👨‍🏫 <b>O'qituvchi:</b> ${g.teacher.fullName}\n`;
        if (g.branch) msg += `🚪 <b>Filial:</b> ${g.branch.name}\n`;
        msg += `\n`;
      }

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3B: Homework
    if (lower.includes('vazifa') || lower === '/homework') {
      const enrolls = await this.db.query.enrollments.findMany({
        where: eq(enrollments.studentId, student.id),
      });
      const groupIds = enrolls.map((e) => e.groupId);

      if (groupIds.length === 0) {
        await this.sendMessage(
          chatId,
          "Siz faol guruhlarda emassiz, shuning uchun vazifalar mavjud emas.",
          kb,
        );
        return;
      }

      const hwList = await this.db.query.homework.findMany({
        where: inArray(homework.groupId, groupIds),
        with: {
          group: true,
          completions: {
            where: eq(homeworkCompletions.studentId, student.id),
          },
        },
        orderBy: [desc(homework.createdAt)],
        limit: 5,
      });

      if (hwList.length === 0) {
        await this.sendMessage(
          chatId,
          "🎉 <b>Ajoyib!</b> Sizga berilgan faol uy vazifalari hozircha yo'q.",
          kb,
        );
        return;
      }

      let msg = `📝 <b>Sizning uy vazifalaringiz:</b>\n\n`;
      for (const h of hwList) {
        const isDone = h.completions.some((c) => c.completed);
        const statusIcon = isDone ? '✅ Bajarilgan' : '⏳ Topshirilmagan';
        const due = h.dueDate
          ? new Date(h.dueDate).toLocaleDateString('uz-UZ')
          : 'Muddatsiz';
        msg += `📌 <b>${h.group.name}</b>: <b>${h.title}</b>\n`;
        if (h.description) {
          const descSnippet =
            h.description.length > 80
              ? h.description.slice(0, 80) + '...'
              : h.description;
          msg += `📖 ${descSnippet}\n`;
        }
        msg += `⏰ <b>Muddati:</b> ${due}\n`;
        msg += `Holat: <b>${statusIcon}</b>\n\n`;
      }

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3C: Balance & Payments
    if (
      lower.includes('balans') ||
      lower.includes("to'lov") ||
      lower.includes('tolov') ||
      lower === '/balance' ||
      lower === '/pay'
    ) {
      const recentPayments = await this.db.query.payments.findMany({
        where: eq(payments.studentId, student.id),
        orderBy: [desc(payments.paidAt)],
        limit: 3,
      });

      let msg = `💳 <b>Hisob va To'lov holati:</b>\n\n`;
      msg += `👤 <b>O'quvchi:</b> ${student.fullName}\n`;
      msg += `💰 <b>Joriy balans:</b> 0 so'm\n\n`;

      if (recentPayments.length > 0) {
        msg += `<b>Oxirgi to'lovlar tarixi:</b>\n`;
        for (const p of recentPayments) {
          msg += `• <b>${p.forMonth}:</b> ${p.amount.toLocaleString('uz-UZ')} so'm (${p.method} — ${p.status})\n`;
        }
      } else {
        msg += `Hozircha to'lovlar tarixi qayd etilmagan.\n`;
      }

      msg += `\n📲 <i>To'lovlarni Click, Payme yoki markaz ma'muriyati orqali amalga oshirishingiz mumkin.</i>`;
      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3D: Attendance
    if (lower.includes('davomat') || lower === '/attendance') {
      const recentAtt = await this.db.query.attendance.findMany({
        where: eq(attendance.studentId, student.id),
        orderBy: [desc(attendance.date)],
        limit: 15,
      });

      const total = recentAtt.length;
      const present = recentAtt.filter((a) => a.status === 'PRESENT').length;
      const late = recentAtt.filter((a) => a.status === 'LATE').length;
      const absent = recentAtt.filter((a) => a.status === 'ABSENT').length;
      const percent =
        total > 0 ? Math.round(((present + late * 0.5) / total) * 100) : 100;

      let msg = `📊 <b>Sizning davomat ko'rsatkichingiz:</b>\n\n`;
      msg += `👤 O'quvchi: <b>${student.fullName}</b>\n`;
      msg += `📈 Umumiy davomat ko'rsatkichi: <b>${percent}%</b>\n\n`;
      msg += `✅ Qatnashdi: <b>${present}</b> ta dars\n`;
      msg += `⚠️ Kechikdi: <b>${late}</b> ta dars\n`;
      msg += `❌ Sababsiz qoldirdi: <b>${absent}</b> ta dars\n\n`;

      if (recentAtt.length > 0) {
        msg += `<b>Oxirgi darslar:</b>\n`;
        for (const a of recentAtt.slice(0, 5)) {
          const icon =
            a.status === 'PRESENT'
              ? '✅ Qatnashdi'
              : a.status === 'LATE'
                ? '⚠️ Kechikdi'
                : '❌ Kelmadi';
          msg += `• ${a.date}: ${icon}\n`;
        }
      }

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3E: Exams
    if (lower.includes('imtihon') || lower === '/exams') {
      const results = await this.db.query.examResults.findMany({
        where: eq(examResults.studentId, student.id),
        with: {
          exam: {
            with: { group: true },
          },
        },
        limit: 5,
      });

      if (results.length === 0) {
        await this.sendMessage(
          chatId,
          "Hozircha topshirilgan imtihon natijalari e'lon qilinmagan.",
          kb,
        );
        return;
      }

      let msg = `🎯 <b>Imtihon natijalari:</b>\n\n👤 O'quvchi: <b>${student.fullName}</b>\n\n`;
      for (const r of results) {
        const max = r.exam.maxScore || 100;
        const pct = Math.round((r.score / max) * 100);
        msg += `📌 <b>${r.exam.title}</b> (${r.exam.group?.name || 'Guruh'})\n`;
        msg += `📊 <b>To'plagan ball:</b> ${r.score} / ${max} (${pct}%)\n`;
        if (r.note) msg += `💬 <b>Izoh:</b> ${r.note}\n`;
        msg += `\n`;
      }

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3F: Center Info / Help
    if (lower.includes('haqida') || lower.includes('markaz') || lower === '/help' || lower === '/info') {
      const orgName = student.tenant?.name || "TalimCRM Ta'lim Markazi";
      let msg = `ℹ️ <b>O'quv markazi ma'lumotlari:</b>\n\n`;
      msg += `🏫 <b>Markaz nomi:</b> ${orgName}\n`;
      msg += `📞 <b>Aloqa:</b> Admin bilan bog'lanish\n`;
      msg += `📍 <b>Tizim:</b> TalimCRM Education OS\n\n`;
      msg += `<i>Savollar yoki takliflar bo'lsa ma'muriyatga murojaat qiling.</i>`;

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3G: Announcements
    if (lower.includes('elon') || lower.includes("e'lon") || lower.includes('yangilik') || lower === '/announcements') {
      const enrolls = await this.db.query.enrollments.findMany({
        where: eq(enrollments.studentId, student.id),
      });
      const groupIds = enrolls.map((e) => e.groupId);

      const audienceConditions = [
        inArray(announcements.targetAudience, ['ALL', 'STUDENTS']),
      ];
      if (groupIds.length > 0) {
        audienceConditions.push(
          and(
            eq(announcements.targetAudience, 'GROUP'),
            inArray(announcements.targetGroupId, groupIds),
          )!,
        );
      }

      const recent = await this.db.query.announcements.findMany({
        where: and(
          eq(announcements.tenantId, student.tenantId),
          or(...audienceConditions)!,
        ),
        orderBy: [desc(announcements.publishedAt)],
        limit: 5,
      });

      if (recent.length === 0) {
        await this.sendMessage(chatId, "Hozircha markazda yangi e'lonlar mavjud emas.", kb);
        return;
      }

      let msg = `📢 <b>Markaz e'lonlari va yangiliklari:</b>\n\n`;
      for (const a of recent) {
        const icon = a.priority === 'URGENT' ? '🚨' : a.priority === 'HIGH' ? '⚡' : '📌';
        msg += `${icon} <b>${a.title}</b>\n`;
        msg += `📅 ${new Date(a.publishedAt).toLocaleDateString('uz-UZ')}\n`;
        msg += `${a.content}\n\n`;
      }

      await this.sendMessage(chatId, msg, kb);
      return;
    }

    // 3H: QR Code & Student Digital Card
    if (lower.includes('qr') || lower.includes('guvohnoma') || lower === '/qr') {
      try {
        const qrBuffer = await qrcode.toBuffer(`TALIMCRM:STUDENT:${student.id}`, {
          width: 450,
          margin: 2,
          color: { dark: '#111827', light: '#FFFFFF' },
        });

        await this.sendPhoto(
          chatId,
          qrBuffer,
          `🪪 <b>O'quvchi Guvohnomasi (QR-Kod)</b>\n\n👤 <b>Ism:</b> ${student.fullName}\n🆔 <b>O'quvchi ID:</b> <code>${student.id}</code>\n🏫 <b>Markaz:</b> ${student.tenant?.name || 'TalimCRM'}\n\n<i>Ushbu QR-kodni o'quv markaziga kirishda administratorga ko'rsatib, davomatni 1 soniyada tasdiqlang.</i>`,
        );
      } catch (err) {
        this.logger.error(`Failed to generate QR code for student ${student.id}: ${err}`);
        await this.sendMessage(chatId, `QR-kod generatsiya qilishda xatolik yuz berdi. ID: ${student.id}`, kb);
      }
      return;
    }

    // Default response for unhandled text
    await this.sendMessage(
      chatId,
      forParent
        ? `Farzandingiz <b>${escapeHtml(student.fullName)}</b> haqida: kerakli bo'limni tanlang.`
        : `Assalomu alaykum, <b>${escapeHtml(student.fullName)}</b>! Kerakli bo'limni tanlang.\n\n🤖 Darsdan savolingiz bo'lsa, "${AI_BUTTON}" tugmasini bosing.`,
      kb,
    );
  }

  // ---- Attendance from the bot (teachers) ----

  // Resolves to whether Telegram accepted the edit.
  async editMessage(chatId: string, messageId: number, text: string, replyMarkup?: unknown): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }),
      });
      if (!res.ok) this.logger.error(`Telegram editMessageText failed: ${res.status} ${await res.text()}`);
      return res.ok;
    } catch (err) {
      this.logger.error(`Telegram editMessageText error: ${(err as Error).message}`);
      return false;
    }
  }

  async deleteMessage(chatId: string, messageId: number) {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
    }).catch(() => undefined);
  }

  async answerCallback(callbackId: string, text?: string) {
    if (!this.token) return;
    await fetch(`https://api.telegram.org/bot${this.token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackId, ...(text ? { text } : {}) }),
    }).catch(() => undefined);
  }

  private sheetView(sheet: AttendanceSheet) {
    const n = (st: AttendanceMark) => sheet.people.filter((p) => p.status === st).length;
    const text =
      `📋 <b>${escapeHtml(sheet.groupName)}</b> — ${sheet.date} davomati\n` +
      `✅ ${n('PRESENT')} · ❌ ${n('ABSENT')} · ⏰ ${n('LATE')}\n\n` +
      `O'quvchini bosib o'zgartiring: ✅ keldi → ❌ kelmadi → ⏰ kechikdi. Oxirida "💾 Saqlash".`;
    const rows = sheet.people.map((p, i) => [{ text: `${MARK_ICON[p.status]} ${p.name}`, callback_data: `am:${sheet.groupId}:${i}` }]);
    rows.push([
      { text: '💾 Saqlash', callback_data: `as:${sheet.groupId}` },
      { text: '✖️ Bekor', callback_data: `ac:${sheet.groupId}` },
    ]);
    return { text, markup: { inline_keyboard: rows } };
  }

  private async handleCallback(cq: any) {
    const chatId: string | undefined = cq?.message?.chat?.id?.toString();
    const messageId: number | undefined = cq?.message?.message_id;
    const data: string = typeof cq?.data === 'string' ? cq.data : '';
    if (!chatId || !messageId || !cq.id) return;
    const staff = await this.findStaff(chatId);
    if (!staff?.tenantId) {
      await this.answerCallback(cq.id, 'Ruxsat yo\'q');
      return;
    }
    // kind:id[:rest] - rest may itself hold ':' (e.g. hg:<homework>:<student>:<score>)
    const [kind, groupId, ...rest] = data.split(':');
    const arg = rest.length ? rest.join(':') : undefined;
    const key = `${chatId}:${groupId}`;

    if (kind === 'ag') {
      const [group] = await this.db
        .select({ id: groups.id, name: groups.name, teacherUserId: teachers.userId })
        .from(groups)
        .leftJoin(teachers, eq(teachers.id, groups.teacherId))
        .where(and(eq(groups.id, groupId), eq(groups.tenantId, staff.tenantId), isNull(groups.deletedAt)));
      // Teachers: only their own groups (the web rule).
      if (!group || (staff.role === 'TEACHER' && group.teacherUserId !== staff.id)) {
        await this.answerCallback(cq.id, 'Bu guruh sizga biriktirilmagan');
        return;
      }
      const { tz } = await this.tenantZone(staff.tenantId);
      const p = zonedParts(new Date(), tz);
      const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
      const kids = await this.db
        .select({ id: students.id, name: students.fullName })
        .from(enrollments)
        .innerJoin(students, eq(students.id, enrollments.studentId))
        .where(and(eq(enrollments.groupId, group.id), eq(enrollments.status, 'ACTIVE'), eq(students.status, 'ACTIVE'), isNull(students.deletedAt)))
        .orderBy(asc(students.fullName));
      if (kids.length === 0) {
        await this.answerCallback(cq.id, "Guruhda faol o'quvchi yo'q");
        return;
      }
      // Start from today's saved marks, else everyone present.
      const saved = await this.db
        .select({ studentId: attendance.studentId, status: attendance.status })
        .from(attendance)
        .where(and(eq(attendance.groupId, group.id), eq(attendance.date, date)));
      const savedBy = new Map(saved.map((r) => [r.studentId, r.status as AttendanceMark]));
      const sheet: AttendanceSheet = {
        tenantId: staff.tenantId,
        groupId: group.id,
        groupName: group.name,
        date,
        people: kids.slice(0, 95).map((k) => ({ id: k.id, name: k.name, status: savedBy.get(k.id) ?? 'PRESENT' })),
      };
      this.sheets.set(key, sheet);
      const view = this.sheetView(sheet);
      await this.answerCallback(cq.id);
      await this.sendMessage(chatId, view.text, view.markup);
      return;
    }

    if (kind === 'hw' || kind === 'hg' || kind === 'hk') {
      await this.homeworkCallback(cq, chatId, messageId, staff, kind, groupId, arg);
      return;
    }

    const sheet = this.sheets.get(key);
    if (!sheet || sheet.tenantId !== staff.tenantId) {
      await this.answerCallback(cq.id, "Ro'yxat eskirdi — \"Bugungi darslarim\" dan qayta oching");
      return;
    }
    if (kind === 'am') {
      const person = sheet.people[Number(arg)];
      if (person) person.status = NEXT_MARK[person.status];
      const view = this.sheetView(sheet);
      await this.answerCallback(cq.id);
      await this.editMessage(chatId, messageId, view.text, view.markup);
      return;
    }
    if (kind === 'ac') {
      this.sheets.delete(key);
      await this.answerCallback(cq.id);
      await this.editMessage(chatId, messageId, `✖️ ${escapeHtml(sheet.groupName)}: davomat saqlanmadi.`);
      return;
    }
    if (kind === 'as') {
      // Loaded lazily: AttendanceModule depends on this module's services.
      const { AttendanceService } = await import('../attendance/attendance.service');
      const service = this.moduleRef.get(AttendanceService, { strict: false });
      try {
        await service.mark(
          sheet.tenantId,
          { groupId: sheet.groupId, date: sheet.date, entries: sheet.people.map((p) => ({ studentId: p.id, status: p.status })) },
          staff.role,
          staff.id,
        );
      } catch (err) {
        await this.answerCallback(cq.id, 'Saqlab bo\'lmadi');
        await this.sendMessage(chatId, `⚠️ ${escapeHtml((err as Error).message)}`);
        return;
      }
      this.sheets.delete(key);
      const n = (st: AttendanceMark) => sheet.people.filter((p) => p.status === st).length;
      const missed = sheet.people.filter((p) => p.status !== 'PRESENT');
      await this.answerCallback(cq.id, 'Saqlandi ✅');
      await this.editMessage(
        chatId,
        messageId,
        `✅ <b>${escapeHtml(sheet.groupName)}</b> — ${sheet.date} davomati saqlandi.\n` +
          `✅ ${n('PRESENT')} · ❌ ${n('ABSENT')} · ⏰ ${n('LATE')}` +
          (missed.length ? `\n\n${missed.map((p) => `${MARK_ICON[p.status]} ${escapeHtml(p.name)}`).join('\n')}\n\nOta-onalarga xabar yuborildi.` : ''),
      );
      return;
    }
    await this.answerCallback(cq.id);
  }

  // ---- Homework review from the bot (teachers) ----

  // Submissions a teacher skipped in this chat: "<chatId>:<homeworkId>" -> studentIds.
  private readonly skipped = new Map<string, Set<string>>();

  private async teacherHomework(chatId: string, staff: StaffUser, tenantId: string, keyboard: unknown) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.db
      .select({ id: homework.id, title: homework.title, maxScore: homework.maxScore, dueDate: homework.dueDate, group: groups.name, groupId: groups.id })
      .from(homework)
      .innerJoin(groups, eq(groups.id, homework.groupId))
      .innerJoin(teachers, eq(teachers.id, groups.teacherId))
      .where(and(eq(homework.tenantId, tenantId), eq(teachers.userId, staff.id), isNull(groups.deletedAt), gte(homework.createdAt, since)))
      .orderBy(desc(homework.createdAt))
      .limit(8);
    if (rows.length === 0) {
      await this.sendMessage(chatId, "📝 So'nggi 30 kunda guruhlaringizga vazifa berilmagan.", keyboard);
      return;
    }
    const counts = await this.db
      .select({ hw: homeworkCompletions.homeworkId, status: homeworkCompletions.status, n: count() })
      .from(homeworkCompletions)
      .where(inArray(homeworkCompletions.homeworkId, rows.map((r) => r.id)))
      .groupBy(homeworkCompletions.homeworkId, homeworkCompletions.status);
    const c = (hw: string, st: string) => Number(counts.find((x) => x.hw === hw && x.status === st)?.n ?? 0);
    const text =
      `📝 <b>Vazifalar</b> (so'nggi 30 kun)\n\n` +
      rows.map((r) => `• <b>${escapeHtml(r.title)}</b> — ${escapeHtml(r.group)}\n   📥 tekshirish: ${c(r.id, 'SUBMITTED')} · ✅ baholangan: ${c(r.id, 'GRADED')}`).join('\n') +
      `\n\nTekshirish uchun vazifani bosing 👇`;
    const buttons = rows.filter((r) => c(r.id, 'SUBMITTED') > 0).map((r) => [{ text: `📥 ${r.title.slice(0, 40)} (${c(r.id, 'SUBMITTED')})`, callback_data: `hw:${r.id}` }]);
    await this.sendMessage(chatId, text, buttons.length ? { inline_keyboard: buttons } : keyboard);
  }

  // The next submission to check (not yet graded, not skipped here).
  private async showNextSubmission(chatId: string, messageId: number | null, staff: StaffUser, homeworkId: string) {
    const [hw] = await this.db
      .select({ id: homework.id, title: homework.title, maxScore: homework.maxScore, group: groups.name, teacherUserId: teachers.userId })
      .from(homework)
      .innerJoin(groups, eq(groups.id, homework.groupId))
      .leftJoin(teachers, eq(teachers.id, groups.teacherId))
      .where(and(eq(homework.id, homeworkId), eq(homework.tenantId, staff.tenantId!)));
    if (!hw || (staff.role === 'TEACHER' && hw.teacherUserId !== staff.id)) return 'forbidden' as const;
    const skip = this.skipped.get(`${chatId}:${homeworkId}`) ?? new Set<string>();
    const pending = await this.db
      .select({ studentId: homeworkCompletions.studentId, name: students.fullName, text: homeworkCompletions.submissionText, url: homeworkCompletions.submissionAttachmentUrl, at: homeworkCompletions.submittedAt })
      .from(homeworkCompletions)
      .innerJoin(students, eq(students.id, homeworkCompletions.studentId))
      .where(and(eq(homeworkCompletions.homeworkId, homeworkId), eq(homeworkCompletions.status, 'SUBMITTED')))
      .orderBy(asc(homeworkCompletions.submittedAt));
    const next = pending.find((p) => !skip.has(p.studentId));
    const max = hw.maxScore || 100;
    if (!next) {
      const done = `✅ <b>${escapeHtml(hw.title)}</b>: tekshiriladigan ish qolmadi.` + (pending.length ? ` (${pending.length} tasi o'tkazib yuborilgan)` : '');
      if (messageId) await this.editMessage(chatId, messageId, done);
      else await this.sendMessage(chatId, done);
      return 'done' as const;
    }
    const clip = (v: string | null, n: number) => (v && v.length > n ? `${v.slice(0, n)}…` : v ?? '');
    const text =
      `📥 <b>${escapeHtml(hw.title)}</b> — ${escapeHtml(hw.group)}\n` +
      `👤 <b>${escapeHtml(next.name)}</b> · qolgan: ${pending.length - skip.size}\n\n` +
      (next.text ? `${escapeHtml(clip(next.text, 900))}\n` : "<i>Matn yo'q</i>\n") +
      (next.url ? `\n📎 ${escapeHtml(next.url)}\n` : '') +
      `\nBaho (maks. ${max}):`;
    const steps = [1, 0.8, 0.6, 0.4, 0].map((f) => Math.round(max * f));
    const markup = {
      inline_keyboard: [
        steps.map((score) => ({ text: String(score), callback_data: `hg:${homeworkId}:${next.studentId}:${score}` })),
        [{ text: "⏭ O'tkazib yuborish", callback_data: `hk:${homeworkId}:${next.studentId}` }],
      ],
    };
    if (messageId) await this.editMessage(chatId, messageId, text, markup);
    else await this.sendMessage(chatId, text, markup);
    return 'shown' as const;
  }

  private async homeworkCallback(cq: any, chatId: string, messageId: number, staff: StaffUser, kind: string, homeworkId: string, arg: string | undefined) {
    if (kind === 'hw') {
      this.skipped.delete(`${chatId}:${homeworkId}`);
      const r = await this.showNextSubmission(chatId, null, staff, homeworkId);
      await this.answerCallback(cq.id, r === 'forbidden' ? 'Bu guruh sizga biriktirilmagan' : undefined);
      return;
    }
    const [studentId, scoreRaw] = (arg ?? '').split(':');
    if (kind === 'hk') {
      const k = `${chatId}:${homeworkId}`;
      this.skipped.set(k, new Set([...(this.skipped.get(k) ?? []), studentId]));
      await this.answerCallback(cq.id);
      await this.showNextSubmission(chatId, messageId, staff, homeworkId);
      return;
    }
    // hg: grade through HomeworkService (teacher scope, student + parents told).
    const { HomeworkService } = await import('../homework/homework.service');
    const service = this.moduleRef.get(HomeworkService, { strict: false });
    try {
      await service.grade(staff.tenantId!, homeworkId, { studentId, score: Number(scoreRaw) }, { role: staff.role, userId: staff.id });
    } catch (err) {
      await this.answerCallback(cq.id, (err as Error).message.slice(0, 180));
      return;
    }
    await this.answerCallback(cq.id, `Baho qo'yildi: ${scoreRaw}`);
    await this.showNextSubmission(chatId, messageId, staff, homeworkId);
  }

  // ---- Parents ----

  // The child a parent's chat is looking at (the active one, else the first).
  private async parentChild(chatId: string) {
    const links = await this.db
      .select({ studentId: telegramParentChats.studentId, active: telegramParentChats.active })
      .from(telegramParentChats)
      .innerJoin(students, eq(students.id, telegramParentChats.studentId))
      .where(and(eq(telegramParentChats.chatId, chatId), isNull(students.deletedAt)))
      .orderBy(asc(telegramParentChats.createdAt));
    const pick = links.find((l) => l.active) ?? links[0];
    if (!pick) return null;
    return (await this.db.query.students.findFirst({ where: eq(students.id, pick.studentId), with: { tenant: true } })) ?? null;
  }

  async parentChatIds(studentId: string): Promise<string[]> {
    const rows = await this.db.select({ chat: telegramParentChats.chatId }).from(telegramParentChats).where(eq(telegramParentChats.studentId, studentId));
    return [...new Set(rows.map((r) => r.chat))];
  }

  private async linkParentChat(chatId: string, token: string) {
    const rec = await this.db.query.telegramLinkTokens.findFirst({
      where: and(
        eq(telegramLinkTokens.token, token),
        eq(telegramLinkTokens.purpose, 'PARENT'),
        isNull(telegramLinkTokens.usedAt),
        gt(telegramLinkTokens.expiresAt, new Date()),
      ),
      with: { student: true },
    });
    if (!rec?.student || rec.student.deletedAt) {
      await this.sendMessage(chatId, "❌ Havola noto'g'ri, muddati (15 daqiqa) o'tgan yoki oldin ishlatilgan.\n\nMarkazdan yangi havola so'rang.");
      return;
    }
    await this.db.update(telegramLinkTokens).set({ usedAt: new Date() }).where(eq(telegramLinkTokens.id, rec.id));
    // A chat is one kind of account: a staff link on it is dropped.
    await this.db.update(users).set({ telegramChatId: null }).where(eq(users.telegramChatId, chatId));
    await this.db.insert(telegramParentChats).values({ tenantId: rec.tenantId, studentId: rec.student.id, chatId }).onConflictDoNothing();
    await this.setActiveChild(chatId, rec.student.id);
    await this.sendMessage(
      chatId,
      `✅ Siz <b>${escapeHtml(rec.student.fullName)}</b> ning ota-onasi sifatida ulandingiz.\n\nDavomat, to'lov va baholar haqida xabarlar shu yerga keladi. Boshqa farzandingizni ham ulash uchun markazdan uning havolasini oling.`,
      PARENT_KEYBOARD,
    );
  }

  private async setActiveChild(chatId: string, studentId: string) {
    await this.db.update(telegramParentChats).set({ active: false }).where(eq(telegramParentChats.chatId, chatId));
    await this.db.update(telegramParentChats).set({ active: true }).where(and(eq(telegramParentChats.chatId, chatId), eq(telegramParentChats.studentId, studentId)));
  }

  private async handleParentText(chatId: string, child: MenuStudent, text: string) {
    if (text === CHILDREN_BUTTON || text === '/children') {
      const kids = await this.db
        .select({ id: students.id, fullName: students.fullName })
        .from(telegramParentChats)
        .innerJoin(students, eq(students.id, telegramParentChats.studentId))
        .where(and(eq(telegramParentChats.chatId, chatId), isNull(students.deletedAt)))
        .orderBy(asc(students.fullName));
      const rows = kids.map((k) => [{ text: `👤 ${k.fullName}` }]);
      await this.sendMessage(
        chatId,
        `👨‍👩‍👧 <b>Farzandlaringiz</b>\n\nHozir: <b>${escapeHtml(child.fullName)}</b>. Kimning ma'lumotini ko'rmoqchisiz?`,
        { keyboard: [...rows, [{ text: '⬅️ Menyu' }]], resize_keyboard: true },
      );
      return;
    }
    if (text.startsWith('👤 ')) {
      const name = text.slice(3).trim();
      const [kid] = await this.db
        .select({ id: students.id, fullName: students.fullName })
        .from(telegramParentChats)
        .innerJoin(students, eq(students.id, telegramParentChats.studentId))
        .where(and(eq(telegramParentChats.chatId, chatId), eq(students.fullName, name), isNull(students.deletedAt)));
      if (kid) {
        await this.setActiveChild(chatId, kid.id);
        await this.sendMessage(chatId, `✅ Endi <b>${escapeHtml(kid.fullName)}</b> ma'lumotlari ko'rsatiladi.`, PARENT_KEYBOARD);
        return;
      }
    }
    if (text === '⬅️ Menyu' || text === '/menu') {
      await this.sendMessage(chatId, `Farzandingiz <b>${escapeHtml(child.fullName)}</b>: kerakli bo'limni tanlang.`, PARENT_KEYBOARD);
      return;
    }
    await this.studentMenu(chatId, child, text, PARENT_KEYBOARD, true);
  }
}
