import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, randomInt } from 'crypto';
import { and, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { signupPhoneCodes } from '../db/schema';
import { EskizProvider } from '../notifications/sms/eskiz.provider';
import { PlayMobileProvider } from '../notifications/sms/playmobile.provider';
import { normalizePhone, maskPhone } from '../leads/phone';
import { TrialClaimsService } from '../trial/trial-claims.service';

const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_CODES_PER_DAY = 5;
const MAX_ATTEMPTS = 5;

const hashCode = (phone: string, code: string) => createHash('sha256').update(`${phone}:${code}`).digest('hex');

function limit(name: string, fallback: number) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

type Exec = Pick<Database, 'update'>;

/**
 * The phone a new center signs up with is confirmed by a six-digit code sent
 * by SMS through the platform's provider. Nothing else stands in for it: no
 * SMS provider means sign-up by phone is unavailable (an e-mail proves an
 * address, not a phone). On a development or test machine only
 * (NODE_ENV=development|test) and with no provider, the code comes back in
 * the answer (channel DEV).
 *
 * A code belongs to one phone, one sign-up attempt and one purpose; only the
 * newest code of a phone counts; codes are asked at most once a minute and
 * five times a day per phone, SIGNUP_CODES_PER_IP_HOUR (10) per address and
 * SIGNUP_CODES_PER_HOUR (300) in all; five wrong guesses use a code up. The
 * counting holds under requests at once. Logs show neither the code nor the
 * whole number.
 */
@Injectable()
export class SignupPhoneService {
  private readonly logger = new Logger(SignupPhoneService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly eskiz: EskizProvider,
    private readonly playmobile: PlayMobileProvider,
    private readonly claims: TrialClaimsService,
  ) {}

  normalize(raw: string | null | undefined): string {
    const phone = normalizePhone(raw);
    if (!phone) throw new BadRequestException({ code: 'PHONE_INVALID', message: "Telefon raqami noto'g'ri" });
    return phone;
  }

  private devCodesAllowed() {
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }

  async start(rawPhone: string, ip: string | undefined) {
    const phone = this.normalize(rawPhone);
    // A phone whose trial was had (and not paid for or released): no code at all.
    await this.claims.rightOf(phone);

    const smsToken = process.env.ESKIZ_API_TOKEN?.trim() || process.env.PLAYMOBILE_API_TOKEN?.trim();
    const channel: 'SMS' | 'DEV' | null = smsToken ? 'SMS' : this.devCodesAllowed() ? 'DEV' : null;
    if (!channel) {
      throw new ServiceUnavailableException({ code: 'SMS_UNAVAILABLE', message: "SMS xizmati hozircha ishlamayapti: telefon orqali ro'yxatdan o'tish vaqtincha mavjud emas. Keyinroq urinib ko'ring." });
    }

    const code = String(randomInt(100_000, 1_000_000));
    const attemptId = randomBytes(16).toString('hex');
    const now = Date.now();
    // One at a time: the counts below and the new row are one decision.
    const id = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('signup-phone-codes'))`);
      const live = and(eq(signupPhoneCodes.purpose, 'SIGNUP'), ne(signupPhoneCodes.status, 'FAILED'));
      const [last] = await tx
        .select({ createdAt: signupPhoneCodes.createdAt })
        .from(signupPhoneCodes)
        .where(and(eq(signupPhoneCodes.phone, phone), live))
        .orderBy(desc(signupPhoneCodes.createdAt))
        .limit(1);
      if (last && now - new Date(last.createdAt).getTime() < RESEND_AFTER_MS) {
        throw new HttpException({ code: 'CODE_TOO_SOON', message: "Kod yuborildi. Yangisini 1 daqiqadan keyin so'rash mumkin." }, HttpStatus.TOO_MANY_REQUESTS);
      }
      const count = async (where: ReturnType<typeof and>) =>
        (await tx.select({ n: sql<number>`count(*)::int` }).from(signupPhoneCodes).where(where))[0].n;
      if ((await count(and(eq(signupPhoneCodes.phone, phone), gt(signupPhoneCodes.createdAt, new Date(now - 86_400_000))))) >= MAX_CODES_PER_DAY) {
        throw new HttpException({ code: 'CODE_DAILY_LIMIT', message: "Bu raqamga bugun juda ko'p kod so'raldi. Ertaga urinib ko'ring." }, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (ip && (await count(and(eq(signupPhoneCodes.ip, ip), gt(signupPhoneCodes.createdAt, new Date(now - 3_600_000))))) >= limit('SIGNUP_CODES_PER_IP_HOUR', 10)) {
        throw new HttpException({ code: 'CODE_IP_LIMIT', message: "Bu manzildan juda ko'p kod so'raldi. Birozdan so'ng urinib ko'ring." }, HttpStatus.TOO_MANY_REQUESTS);
      }
      if ((await count(gt(signupPhoneCodes.createdAt, new Date(now - 3_600_000)))) >= limit('SIGNUP_CODES_PER_HOUR', 300)) {
        this.logger.warn('Sign-up code limit for the hour reached');
        throw new ServiceUnavailableException({ code: 'CODE_SERVICE_LIMIT', message: "Hozir juda ko'p so'rov bor. Birozdan so'ng urinib ko'ring." });
      }
      // Only the newest code of a phone counts.
      await tx
        .update(signupPhoneCodes)
        .set({ supersededAt: new Date(now) })
        .where(and(eq(signupPhoneCodes.phone, phone), isNull(signupPhoneCodes.usedAt), isNull(signupPhoneCodes.supersededAt)));
      const [row] = await tx
        .insert(signupPhoneCodes)
        .values({
          phone, codeHash: hashCode(phone, code), expiresAt: new Date(now + CODE_TTL_MS), ip: ip ?? null,
          attemptId, purpose: 'SIGNUP', channel, status: channel === 'SMS' ? 'SENDING' : 'SENT',
        })
        .returning({ id: signupPhoneCodes.id });
      return row.id;
    });

    if (channel === 'SMS') {
      const usePlaymobile = !process.env.ESKIZ_API_TOKEN?.trim();
      const provider = usePlaymobile ? this.playmobile : this.eskiz;
      const sender = (usePlaymobile ? process.env.PLAYMOBILE_ORIGINATOR : process.env.ESKIZ_SENDER)?.trim() || '4546';
      let ok = false;
      try {
        ok = (await provider.sendSms(phone, `TalimCRM tasdiqlash kodi: ${code}. Kodni hech kimga bermang.`, { sender })).success;
      } catch {
        ok = false;
      }
      await this.db.update(signupPhoneCodes).set({ status: ok ? 'SENT' : 'FAILED' }).where(eq(signupPhoneCodes.id, id));
      if (!ok) {
        this.logger.warn(`Sign-up SMS to ${maskPhone(phone)} was not accepted by the provider`);
        throw new ServiceUnavailableException({ code: 'SMS_FAILED', message: "SMS yuborib bo'lmadi. Raqamni tekshirib, birozdan so'ng qayta urinib ko'ring." });
      }
    }
    return { channel, attemptId, expiresAt: new Date(now + CODE_TTL_MS), ...(channel === 'DEV' ? { devCode: code } : {}) };
  }

  /**
   * Checks the code of this phone and attempt, counting the guess first (in
   * its own write, so a wrong guess stays counted whatever happens next).
   * Returns the code's row; it is used up by use() in the sign-up's own
   * transaction, so a sign-up that fails leaves it usable.
   */
  async verify(rawPhone: string, rawCode: string, attemptId: string | undefined): Promise<string> {
    const phone = this.normalize(rawPhone);
    const expired = () => new BadRequestException({ code: 'CODE_EXPIRED', message: "Kod eskirgan yoki so'ralmagan. Yangi kod oling." });
    if (!attemptId) throw expired();
    const [row] = await this.db
      .select()
      .from(signupPhoneCodes)
      .where(and(
        eq(signupPhoneCodes.phone, phone), eq(signupPhoneCodes.attemptId, attemptId), eq(signupPhoneCodes.purpose, 'SIGNUP'),
        eq(signupPhoneCodes.status, 'SENT'), isNull(signupPhoneCodes.supersededAt),
      ))
      .limit(1);
    if (!row || new Date(row.expiresAt) < new Date()) throw expired();
    if (row.usedAt) {
      // The sign-up may be a retry of the same attempt: the right code, no new guess counted.
      if (row.codeHash !== hashCode(phone, String(rawCode ?? '').trim())) throw new BadRequestException({ code: 'CODE_WRONG', message: "Kod noto'g'ri" });
      return row.id;
    }
    const [counted] = await this.db
      .update(signupPhoneCodes)
      .set({ attempts: sql`${signupPhoneCodes.attempts} + 1` })
      .where(and(eq(signupPhoneCodes.id, row.id), lt(signupPhoneCodes.attempts, MAX_ATTEMPTS)))
      .returning({ attempts: signupPhoneCodes.attempts });
    if (!counted) throw new BadRequestException({ code: 'CODE_ATTEMPTS', message: "Urinishlar tugadi. Yangi kod oling." });
    if (row.codeHash !== hashCode(phone, String(rawCode ?? '').trim())) {
      throw new BadRequestException({ code: 'CODE_WRONG', message: "Kod noto'g'ri" });
    }
    return row.id;
  }

  /** Uses the code up, in the sign-up's transaction; false when it already was. */
  async use(tx: Exec, codeId: string): Promise<boolean> {
    const [row] = await tx
      .update(signupPhoneCodes)
      .set({ usedAt: new Date() })
      .where(and(eq(signupPhoneCodes.id, codeId), isNull(signupPhoneCodes.usedAt)))
      .returning({ id: signupPhoneCodes.id });
    return !!row;
  }

  /** Codes older than `days` are of no use any more (kept that long for the limits and checks). */
  async cleanup(days = 30): Promise<number> {
    const gone = await this.db.delete(signupPhoneCodes).where(lt(signupPhoneCodes.createdAt, new Date(Date.now() - days * 86_400_000))).returning({ id: signupPhoneCodes.id });
    return gone.length;
  }
}
