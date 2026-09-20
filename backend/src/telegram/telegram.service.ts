import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { students } from '../db/schema';

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

  // Deep link a parent opens to link their chat to a student's record.
  // Telegram only lets a bot message a user after that user has started
  // a chat with it, so this /start<payload> handshake is required —
  // there's no way to message @username directly from the Bot API.
  linkUrl(studentId: string) {
    if (!this.botUsername) return null;
    return `https://t.me/${this.botUsername}?start=${studentId}`;
  }

  async sendMessage(chatId: string, text: string) {
    if (!this.token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — skipping message send');
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        this.logger.error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
      }
    } catch (err) {
      this.logger.error(`Telegram sendMessage error: ${(err as Error).message}`);
    }
  }

  async notifyStudent(studentId: string, text: string) {
    const student = await this.db.query.students.findFirst({ where: eq(students.id, studentId) });
    if (!student?.telegramChatId) return;
    await this.sendMessage(student.telegramChatId, text);
  }

  // Handles Telegram's webhook payload. Only the `/start <studentId>` deep
  // link is supported for now — that's what links a parent's chat to a
  // student record so notifyStudent() can reach them later.
  async handleUpdate(update: any) {
    const message = update?.message;
    const text: string | undefined = message?.text;
    const chatId: string | undefined = message?.chat?.id?.toString();
    if (!text || !chatId) return;

    if (text.startsWith('/start')) {
      const studentId = text.replace('/start', '').trim();
      if (!studentId) {
        await this.sendMessage(chatId, "Assalomu alaykum! TalimCRM botiga xush kelibsiz.");
        return;
      }
      const student = await this.db.query.students.findFirst({ where: eq(students.id, studentId) });
      if (!student) {
        await this.sendMessage(chatId, "Havola noto'g'ri yoki eskirgan. Iltimos, markazdan yangi havola so'rang.");
        return;
      }
      await this.db.update(students).set({ telegramChatId: chatId }).where(eq(students.id, studentId));
      await this.sendMessage(
        chatId,
        `Tabriklaymiz! Siz endi ${student.fullName} uchun davomat va to'lov xabarnomalarini shu yerda olasiz.`,
      );
    }
  }
}
