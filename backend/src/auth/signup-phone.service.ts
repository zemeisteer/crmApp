import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomInt } from 'crypto';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { signupPhoneCodes, tenants } from '../db/schema';
import { EmailService } from '../email/email.service';
import { EskizProvider } from '../notifications/sms/eskiz.provider';
import { PlayMobileProvider } from '../notifications/sms/playmobile.provider';
import { normalizePhone, maskPhone } from '../leads/phone';

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_CODES_PER_DAY = 5;
const MAX_ATTEMPTS = 5;

const hashCode = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest('hex');

/**
 * The phone a new center signs up with is confirmed with a six-digit code:
 * one free trial per number. The code goes by SMS through the platform's
 * provider; when no SMS provider is set up it goes to the e-mail given in
 * the form, and on a development machine with neither it comes back in the
 * answer (never in production).
 */
@Injectable()
export class SignupPhoneService {
  private readonly logger = new Logger(SignupPhoneService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly email: EmailService,
    private readonly eskiz: EskizProvider,
    private readonly playmobile: PlayMobileProvider,
  ) {}

  /** A phone not yet used for a trial, normalized (+998...). */
  async freePhone(raw: string | null | undefined): Promise<string> {
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException({ code: 'PHONE_INVALID', message: "Telefon raqami noto'g'ri" });
    const [taken] = await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.signupPhone, phone));
    if (taken) {
      throw new ConflictException({ code: 'PHONE_USED', message: "Bu raqam bilan bepul sinov allaqachon olingan. Tizimga kiring yoki tarif tanlang." });
    }
    return phone;
  }

  async start(rawPhone: string, rawEmail: string | undefined, ip: string | undefined) {
    const phone = await this.freePhone(rawPhone);
    const now = Date.now();
    const recent = await this.db
      .select({ createdAt: signupPhoneCodes.createdAt })
      .from(signupPhoneCodes)
      .where(and(eq(signupPhoneCodes.phone, phone), gt(signupPhoneCodes.createdAt, new Date(now - 86_400_000))))
      .orderBy(desc(signupPhoneCodes.createdAt));
    if (recent[0] && now - new Date(recent[0].createdAt).getTime() < RESEND_AFTER_MS) {
      throw new HttpException({ code: 'CODE_TOO_SOON', message: "Kod yuborildi. Yangisini 1 daqiqadan keyin so'rash mumkin." }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (recent.length >= MAX_CODES_PER_DAY) {
      throw new HttpException({ code: 'CODE_DAILY_LIMIT', message: "Bu raqamga bugun juda ko'p kod so'raldi. Ertaga urinib ko'ring." }, HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(100_000, 1_000_000));
    const text = `TalimCRM tasdiqlash kodi: ${code}. Kodni hech kimga bermang.`;
    const smsToken = process.env.ESKIZ_API_TOKEN?.trim() || process.env.PLAYMOBILE_API_TOKEN?.trim();
    const email = rawEmail?.trim().toLowerCase();
    let channel: 'SMS' | 'EMAIL' | 'DEV';
    if (smsToken) channel = 'SMS';
    else if (this.email.isConfigured && email) channel = 'EMAIL';
    else if (process.env.NODE_ENV !== 'production') channel = 'DEV';
    else throw new ServiceUnavailableException("Tasdiqlash kodini yuborib bo'lmadi. Birozdan so'ng urinib ko'ring.");

    await this.db.insert(signupPhoneCodes).values({ phone, codeHash: hashCode(phone, code), expiresAt: new Date(now + CODE_TTL_MS), ip: ip ?? null });

    if (channel === 'SMS') {
      const usePlaymobile = !process.env.ESKIZ_API_TOKEN?.trim();
      const provider = usePlaymobile ? this.playmobile : this.eskiz;
      const sender = (usePlaymobile ? process.env.PLAYMOBILE_ORIGINATOR : process.env.ESKIZ_SENDER)?.trim() || '4546';
      const res = await provider.sendSms(phone, text, { sender });
      if (!res.success) {
        this.logger.warn(`signup code to ${maskPhone(phone)} failed: ${res.error}`);
        throw new ServiceUnavailableException("SMS yuborib bo'lmadi. Raqamni tekshirib, qayta urinib ko'ring.");
      }
    } else if (channel === 'EMAIL') {
      void this.email.send(email!, 'TalimCRM tasdiqlash kodi', `${text}\n\nKod ${phone} raqami uchun so'raldi.`);
    }
    return { channel, ...(channel === 'DEV' ? { devCode: code } : {}) };
  }

  /** Checks the latest code sent to the phone and uses it up. */
  async consume(rawPhone: string, code: string): Promise<string> {
    const phone = await this.freePhone(rawPhone);
    const [row] = await this.db
      .select()
      .from(signupPhoneCodes)
      .where(and(eq(signupPhoneCodes.phone, phone), isNull(signupPhoneCodes.usedAt)))
      .orderBy(desc(signupPhoneCodes.createdAt))
      .limit(1);
    if (!row || new Date(row.expiresAt) < new Date()) {
      throw new BadRequestException({ code: 'CODE_EXPIRED', message: "Kod eskirgan yoki so'ralmagan. Yangi kod oling." });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new BadRequestException({ code: 'CODE_ATTEMPTS', message: "Urinishlar tugadi. Yangi kod oling." });
    }
    if (row.codeHash !== hashCode(phone, String(code ?? '').trim())) {
      await this.db.update(signupPhoneCodes).set({ attempts: sql`${signupPhoneCodes.attempts} + 1` }).where(eq(signupPhoneCodes.id, row.id));
      throw new BadRequestException({ code: 'CODE_WRONG', message: "Kod noto'g'ri" });
    }
    // Used once: a second sign-up with the same code finds nothing.
    const [used] = await this.db
      .update(signupPhoneCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(signupPhoneCodes.id, row.id), isNull(signupPhoneCodes.usedAt)))
      .returning({ id: signupPhoneCodes.id });
    if (!used) throw new BadRequestException({ code: 'CODE_EXPIRED', message: "Kod eskirgan yoki so'ralmagan. Yangi kod oling." });
    return phone;
  }
}
