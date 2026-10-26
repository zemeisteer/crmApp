import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, platformPaymentClaims, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { PlansService } from '../plans/plans.service';
import { TelegramService } from '../telegram/telegram.service';
import { UPLOAD_DIR } from '../common/upload.util';
import { isUniqueViolation } from '../common/db-errors';
import { applyPayment, nextPaymentMonth, openMonthInvoice } from './billing-period';

const money = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "8600123412341234" -> "8600 1234 1234 1234". */
const groupCard = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');
const KEY_RE = /^[A-Za-z0-9_-]{8,80}$/;

type Claim = typeof platformPaymentClaims.$inferSelect;

/**
 * A center paying the platform by card transfer, for while the platform has
 * no Click/Payme contract (or besides it): the platform admin's card (set in
 * the panel: PLATFORM_CARD_NUMBER, PLATFORM_CARD_HOLDER) is shown on the
 * plans page, the center's owner sends a receipt for a tariff, the platform
 * admins hear of it, and their "confirm" records the month paid exactly as
 * a Click/Payme payment does (billing-period.ts). Nothing is extended until
 * a person has checked the money arrived.
 *
 * The month and the amount are the server's (the next month to pay, the
 * tariff's price). Each money-related decision is one transaction, in one
 * lock order: the receipt, then the center's payment lock, the invoice and
 * the center (openMonthInvoice / applyPayment); messages go out after it
 * commits.
 */
@Injectable()
export class PlatformCardService {
  private readonly logger = new Logger('PlatformCard');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly plans: PlansService,
    private readonly telegram: TelegramService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  card() {
    const digits = (this.config.get<string>('PLATFORM_CARD_NUMBER') ?? '').replace(/\D/g, '');
    const holder = (this.config.get<string>('PLATFORM_CARD_HOLDER') ?? '').trim();
    return digits.length === 16 && holder ? { number: groupCard(digits), holder } : null;
  }

  // ---- the center ----

  async centerView(tenantId: string) {
    const claims = await this.db
      .select({
        id: platformPaymentClaims.id,
        plan: platformPaymentClaims.plan,
        forMonth: platformPaymentClaims.forMonth,
        amount: platformPaymentClaims.amount,
        status: platformPaymentClaims.status,
        rejectReason: platformPaymentClaims.rejectReason,
        createdAt: platformPaymentClaims.createdAt,
      })
      .from(platformPaymentClaims)
      .where(eq(platformPaymentClaims.tenantId, tenantId))
      .orderBy(desc(platformPaymentClaims.createdAt), desc(platformPaymentClaims.id))
      .limit(12);
    // What a new payment would be for: shown before sending, decided here.
    return { card: this.card(), nextMonth: await nextPaymentMonth(this.db, tenantId), claims };
  }

  /**
   * "We paid": one receipt waiting per center and month (a unique index),
   * and a retry of the same send (the same key) gets the same receipt back
   * (`replay`) - the caller then removes the duplicate upload.
   */
  async submit(tenantId: string, userId: string, dto: { plan: string; note?: string; receiptFile: string; idempotencyKey?: string }): Promise<{ claim: Claim; replay: boolean }> {
    if (!this.card()) throw new BadRequestException("Karta orqali to'lov hozircha yoqilmagan");
    const key = dto.idempotencyKey?.trim() || null;
    if (key && !KEY_RE.test(key)) throw new BadRequestException("Idempotency-Key noto'g'ri");
    if (key) {
      const prior = await this.byKey(tenantId, key);
      if (prior) return { claim: prior, replay: true };
    }
    const plan = await this.plans.getByKey(dto.plan).catch(() => null);
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    if (plan.price <= 0) throw new BadRequestException("Bepul tarif uchun to'lov kerak emas");
    const forMonth = await nextPaymentMonth(this.db, tenantId);

    let claim: Claim;
    try {
      claim = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(platformPaymentClaims)
          .values({ tenantId, plan: plan.key, forMonth, amount: plan.price, receiptFile: dto.receiptFile, note: dto.note?.trim().slice(0, 500) || null, sentByUserId: userId, idempotencyKey: key })
          .returning();
        await this.audit.record(tx, { tenantId, userId, action: 'create', entityType: 'platform_payment_claim', entityId: row.id, meta: { plan: plan.key, forMonth, amount: plan.price } });
        return row;
      });
    } catch (err) {
      const idem = isUniqueViolation(err, 'platform_payment_claims_idem_idx');
      const pending = isUniqueViolation(err, 'platform_payment_claims_one_pending_idx');
      // The same send that raced us (either index may report it first): its
      // receipt is committed by now, so it is the answer.
      if (key && (idem || pending)) {
        const prior = await this.byKey(tenantId, key);
        if (prior) return { claim: prior, replay: true };
      }
      if (pending) {
        throw new ConflictException({ code: 'PENDING', message: `${forMonth} oyi uchun yuborilgan chek hali tekshirilmoqda` });
      }
      throw err;
    }
    // After the commit: a Telegram or mail hiccup never loses the receipt.
    void this.tellPlatform(tenantId, plan.name, plan.price, forMonth).catch((err) => this.logger.warn(`notice: ${(err as Error).message}`));
    return { claim, replay: false };
  }

  private async byKey(tenantId: string, key: string) {
    const [c] = await this.db.select().from(platformPaymentClaims).where(and(eq(platformPaymentClaims.tenantId, tenantId), eq(platformPaymentClaims.idempotencyKey, key)));
    return c;
  }

  /** The platform admins: in Telegram when linked, else by mail. */
  private async tellPlatform(tenantId: string, planName: string, amount: number, forMonth: string) {
    const [t] = await this.db.select({ name: tenants.name, subdomain: tenants.subdomain }).from(tenants).where(eq(tenants.id, tenantId));
    const admins = await this.db.select({ email: users.email, chat: users.telegramChatId }).from(users).where(eq(users.role, 'SUPERADMIN'));
    const text = `💳 Obuna uchun karta to'lovi keldi\n${t?.name ?? ''} (${t?.subdomain ?? ''})\n${planName} · ${forMonth} · ${money(amount)} so'm\n\nTekshirib tasdiqlang: Platforma → Obunalar → "Karta to'lovlari".`;
    for (const a of admins) {
      if (a.chat) await this.telegram.sendMessage(a.chat, escape(text));
      else await this.email.deliver(a.email, `TalimCRM: ${t?.name ?? ''} karta orqali to'ladi`, text);
    }
  }

  // ---- the platform admin ----

  /**
   * One page of receipts. Waiting ones oldest first (a queue: nothing old is
   * pushed out of sight), decided ones newest first; ties by id, so pages
   * never repeat or skip a row.
   */
  async list(q: { status?: string; page?: number; pageSize?: number }) {
    const status = q.status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(q.status) ? q.status : undefined;
    const pageSize = Math.min(100, Math.max(1, Math.trunc(Number(q.pageSize) || 25)));
    const page = Math.max(1, Math.trunc(Number(q.page) || 1));
    const where = status ? eq(platformPaymentClaims.status, status) : undefined;
    const order = status === 'PENDING'
      ? [asc(platformPaymentClaims.createdAt), asc(platformPaymentClaims.id)]
      : [desc(platformPaymentClaims.createdAt), desc(platformPaymentClaims.id)];
    const [rows, [{ total }], [{ pending }]] = await Promise.all([
      this.db
        .select({ c: platformPaymentClaims, centerName: tenants.name, subdomain: tenants.subdomain, reviewedBy: users.fullName })
        .from(platformPaymentClaims)
        .innerJoin(tenants, eq(tenants.id, platformPaymentClaims.tenantId))
        .leftJoin(users, eq(users.id, platformPaymentClaims.reviewedByUserId))
        .where(where)
        .orderBy(...order)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: sql<number>`count(*)::int` }).from(platformPaymentClaims).where(where),
      this.db.select({ pending: sql<number>`count(*)::int` }).from(platformPaymentClaims).where(eq(platformPaymentClaims.status, 'PENDING')),
    ]);
    return {
      page,
      pageSize,
      total,
      pending,
      card: this.card(),
      items: rows.map((r) => ({ ...r.c, idempotencyKey: undefined, centerName: r.centerName, subdomain: r.subdomain, reviewedBy: r.reviewedBy })),
    };
  }

  /** The receipt's path on disk, for the platform admin's own download. */
  async receiptPath(id: string) {
    const [c] = await this.db.select({ file: platformPaymentClaims.receiptFile }).from(platformPaymentClaims).where(eq(platformPaymentClaims.id, id));
    const path = c ? join(UPLOAD_DIR, c.file) : null;
    if (!path || !existsSync(path)) throw new NotFoundException('Chek topilmadi');
    return { path, name: c!.file };
  }

  /**
   * The money arrived: in one transaction the receipt is confirmed, the
   * month's invoice is paid, the center's paid time grows and the audit row
   * is written - all or nothing. The receipt row is locked first, so a
   * second confirm (another admin, a retry) waits and then gets the same
   * answer (`replay`), and a reject at the same moment either wins or sees
   * it confirmed. A month paid meanwhile (Click/Payme, by hand) or a
   * provider payment under way is refused and the receipt stays waiting.
   */
  async confirm(actorId: string, id: string) {
    const out = await this.db.transaction(async (tx) => {
      const [claim] = await tx.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.id, id)).for('update');
      if (!claim) throw new NotFoundException('Chek topilmadi');
      if (claim.status === 'CONFIRMED') return { claim, replay: true, paidUntil: null as Date | null };
      if (claim.status === 'REJECTED') throw new ConflictException({ code: 'REJECTED', message: 'Bu chek rad etilgan' });
      const invoice = await openMonthInvoice(tx, claim.tenantId, claim.forMonth, claim.plan, claim.amount, null);
      const paid = await applyPayment(tx, invoice.id);
      if (paid.outcome !== 'PAID' || !paid.sub) throw new ConflictException("To'lovni qayd etib bo'lmadi");
      const [done] = await tx
        .update(platformPaymentClaims)
        .set({ status: 'CONFIRMED', reviewedByUserId: actorId, reviewedAt: new Date(), subscriptionId: paid.sub.id })
        .where(eq(platformPaymentClaims.id, id))
        .returning();
      await this.audit.record(tx, { tenantId: claim.tenantId, userId: actorId, action: 'create', entityType: 'platform_payment', entityId: paid.sub.id, meta: { forMonth: claim.forMonth, plan: claim.plan, amount: claim.amount, card: true, claim: id } });
      return { claim: done, replay: false, paidUntil: paid.sub.periodEnd };
    });
    if (!out.replay) {
      void this.tellCenter(out.claim.tenantId, `✅ ${out.claim.forMonth} oyi uchun ${money(out.claim.amount)} so'm to'lovingiz tasdiqlandi. Obuna ${out.paidUntil?.toISOString().slice(0, 10)} gacha uzaytirildi. Rahmat!`).catch(() => undefined);
    }
    return { id, status: 'CONFIRMED', subscriptionId: out.claim.subscriptionId, replay: out.replay };
  }

  /** Not paid: the reason the center sees. Same receipt lock as confirm. */
  async reject(actorId: string, id: string, reason: string) {
    const why = (reason ?? '').trim().slice(0, 300);
    if (!why) throw new BadRequestException('Rad etish sababini yozing');
    const out = await this.db.transaction(async (tx) => {
      const [claim] = await tx.select().from(platformPaymentClaims).where(eq(platformPaymentClaims.id, id)).for('update');
      if (!claim) throw new NotFoundException('Chek topilmadi');
      if (claim.status === 'REJECTED') return { claim, replay: true };
      if (claim.status === 'CONFIRMED') throw new ConflictException({ code: 'CONFIRMED', message: "Bu chek allaqachon tasdiqlangan: obuna uzaytirilgan" });
      const [done] = await tx
        .update(platformPaymentClaims)
        .set({ status: 'REJECTED', rejectReason: why, reviewedByUserId: actorId, reviewedAt: new Date() })
        .where(eq(platformPaymentClaims.id, id))
        .returning();
      await this.audit.record(tx, { tenantId: claim.tenantId, userId: actorId, action: 'update', entityType: 'platform_payment_claim', entityId: id, meta: { rejected: why } });
      return { claim: done, replay: false };
    });
    if (!out.replay) void this.tellCenter(out.claim.tenantId, `❌ ${out.claim.forMonth} oyi uchun karta to'lovi tasdiqlanmadi: ${why}`).catch(() => undefined);
    return { id, status: 'REJECTED', replay: out.replay };
  }

  /** The center's owners and admins: Telegram when linked, and mail. */
  private async tellCenter(tenantId: string, text: string) {
    const people = await this.db
      .select({ email: users.email, chat: users.telegramChatId })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(and(eq(organizationMemberships.tenantId, tenantId), eq(organizationMemberships.status, 'ACTIVE'), inArray(organizationMemberships.role, ['OWNER', 'ADMIN'])));
    for (const p of people) {
      if (p.chat) await this.telegram.sendMessage(p.chat, escape(text));
      await this.email.deliver(p.email, "TalimCRM: obuna to'lovi", `${text}\n\nTalimCRM`);
    }
  }
}
