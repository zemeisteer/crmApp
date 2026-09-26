import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { randomBytes, timingSafeEqual } from 'crypto';
import * as qrcode from 'qrcode';
import { DB, Database } from '../db/db.module';
import {
  announcements,
  attendance,
  enrollments,
  examResults,
  homework,
  homeworkCompletions,
  payments,
  students,
  telegramLinkTokens,
  users,
} from '../db/schema';

const MAIN_KEYBOARD = {
  keyboard: [
    [{ text: '📅 Dars jadvali' }, { text: '📝 Uy vazifalar' }],
    [{ text: "💳 Balans va to'lov" }, { text: '📊 Davomat' }],
    [{ text: '🎯 Imtihonlar' }, { text: "📢 E'lonlar" }],
    [{ text: '🪪 Mening QR-kodim' }, { text: 'ℹ️ Markaz haqida' }],
  ],
  resize_keyboard: true,
};


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
  ) {}

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
  async generateLinkToken(tenantId: string, studentId: string) {
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
      token,
      expiresAt,
    });

    const linkUrl = this.botUsername
      ? `https://t.me/${this.botUsername}?start=link_${token}`
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
    if (!secret) return true;
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
    await this.db.update(users).set({ telegramChatId: chatId }).where(eq(users.id, linkRecord.user.id));
    await this.sendMessage(
      chatId,
      `✅ <b>${escapeHtml(linkRecord.user.fullName)}</b>, Telegram hisobingiz CRMAPP'ga ulandi.\n\nEndi yangi arizalar, qayta aloqa va sinov darslari haqidagi eslatmalar shu yerga keladi.`,
    );
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: any) {
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — skipping message send');
      return;
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
      }
    } catch (err) {
      this.logger.error(`Telegram sendMessage error: ${(err as Error).message}`);
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


  async notifyStudent(studentId: string, text: string) {
    const student = await this.db.query.students.findFirst({ where: eq(students.id, studentId) });
    if (!student?.telegramChatId) return;
    await this.sendMessage(student.telegramChatId, text);
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
    if (!student?.telegramChatId) return;

    const percentage = Math.round((score / (maxScore || 100)) * 100);
    let grade = 'B';
    if (percentage >= 90) grade = "A'lo (A+)";
    else if (percentage >= 80) grade = 'Yaxshi (A)';
    else if (percentage >= 70) grade = 'Qoniqarli (B)';
    else if (percentage >= 60) grade = 'Yetarli (C)';
    else grade = 'Qoniqarsiz (F)';

    const message = `🎯 <b>Imtihon natijangiz e'lon qilindi!</b>\n\n📌 <b>Imtihon:</b> ${examTitle}\n📊 <b>To'plagan ballingiz:</b> ${score} / ${maxScore} (${percentage}%)\n🏅 <b>Baholash:</b> ${grade}${note ? `\n💬 <b>Izoh:</b> ${note}` : ''}\n\n<i>TalimCRM tizimi orqali yuborildi.</i>`;

    await this.sendMessage(student.telegramChatId, message);
  }

  async broadcastAnnouncement(
    tenantId: string,
    title: string,
    content: string,
    priority: string = 'NORMAL',
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

    const formattedMessage = `${priorityIcon} <b>${priorityLabel}: ${title}</b>\n\n${content}\n\n<i>TalimCRM tizimi orqali tarqatildi.</i>`;

    if (targetGroupId) {
      await this.notifyGroup(tenantId, targetGroupId, formattedMessage);
      return;
    }

    const linkedStudents = await this.db.query.students.findMany({
      where: and(eq(students.tenantId, tenantId), isNotNull(students.telegramChatId)),
      columns: { telegramChatId: true },
    });

    for (const s of linkedStudents) {
      if (s.telegramChatId) {
        void this.sendMessage(s.telegramChatId, formattedMessage);
      }
    }
  }

  // Handles Telegram webhook payload with interactive commands & account linking
  async handleUpdate(update: any) {
    const message = update?.message;
    const text: string | undefined = message?.text?.trim();
    const chatId: string | undefined = message?.chat?.id?.toString();
    if (!text || !chatId) return;

    // 1. Check for /start command
    if (text.startsWith('/start')) {
      const rawPayload = text.replace('/start', '').trim();
      if (!rawPayload) {
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

      const token = rawPayload.startsWith('link_')
        ? rawPayload.replace('link_', '')
        : rawPayload;

      const linkRecord = await this.db.query.telegramLinkTokens.findFirst({
        where: and(
          eq(telegramLinkTokens.token, token),
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

      // Link student's telegram chat ID
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

    // 2. Look up the student linked with this chat ID
    const student = await this.db.query.students.findFirst({
      where: eq(students.telegramChatId, chatId),
      with: {
        tenant: true,
      },
    });

    if (!student) {
      const staff = await this.db.query.users.findFirst({ where: eq(users.telegramChatId, chatId), columns: { fullName: true } });
      if (staff) {
        await this.sendMessage(
          chatId,
          `${escapeHtml(staff.fullName)}, bu chat CRMAPP eslatmalari uchun ulangan. Eslatmalarni o'chirish uchun CRM'dagi "Telegram eslatmalari" bo'limidan foydalaning.`,
        );
        return;
      }
      await this.sendMessage(
        chatId,
        "⚠️ Sizning Telegram akkauntingiz hali TalimCRM tizimidagi hech qaysi o'quvchiga ulanmagan.\n\nUlash uchun o'quv markazingizdan maxsus bir martalik havola oling.",
      );
      return;
    }

    // 3. Dispatch interactive reply keyboard button presses or commands
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
          MAIN_KEYBOARD,
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

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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
          MAIN_KEYBOARD,
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
          MAIN_KEYBOARD,
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

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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
      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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
          MAIN_KEYBOARD,
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

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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
        await this.sendMessage(chatId, "Hozircha markazda yangi e'lonlar mavjud emas.", MAIN_KEYBOARD);
        return;
      }

      let msg = `📢 <b>Markaz e'lonlari va yangiliklari:</b>\n\n`;
      for (const a of recent) {
        const icon = a.priority === 'URGENT' ? '🚨' : a.priority === 'HIGH' ? '⚡' : '📌';
        msg += `${icon} <b>${a.title}</b>\n`;
        msg += `📅 ${new Date(a.publishedAt).toLocaleDateString('uz-UZ')}\n`;
        msg += `${a.content}\n\n`;
      }

      await this.sendMessage(chatId, msg, MAIN_KEYBOARD);
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
        await this.sendMessage(chatId, `QR-kod generatsiya qilishda xatolik yuz berdi. ID: ${student.id}`, MAIN_KEYBOARD);
      }
      return;
    }

    // Default response for unhandled text
    await this.sendMessage(
      chatId,
      `Assalomu alaykum, <b>${student.fullName}</b>! Kerakli bo'limni ko'rish uchun quyidagi tugmalardan birini tanlang:`,
      MAIN_KEYBOARD,
    );
  }
}

