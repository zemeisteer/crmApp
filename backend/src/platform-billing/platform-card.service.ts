import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { existsSync } from 'fs';
import { join } from 'path';
import { DB, Database } from '../db/db.module';
import { organizationMemberships, platformPaymentClaims, platformSubscriptions, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../email/email.service';
import { PlansService } from '../plans/plans.service';
import { TelegramService } from '../telegram/telegram.service';
import { UPLOAD_DIR } from '../common/upload.util';
import { applyPayment } from './billing-period';

const money = (n: number) => new Intl.NumberFormat('uz-UZ').format(n);
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** "8600123412341234" -> "8600 1234 1234 1234". */
const groupCard = (digits: string) => digits.replace(/(\d{4})(?=\d)/g, '$1 ');

/**
 * A center paying the platform by card transfer, for while the platform has
 * no Click/Payme contract (or besides it): the platform admin's card (set in
 * the panel: PLATFORM_CARD_NUMBER, PLATFORM_CARD_HOLDER) is shown on the
 * plans page, the center's owner sends a receipt for a tariff and a month,
 * the platform admins hear of it, and their "confirm" records that month
 * paid exactly as a Click/Payme payment does (billing-period.ts). Nothing
 * is extended until a person has checked the money arrived.
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
      .orderBy(desc(platformPaymentClaims.createdAt))
      .limit(12);
    return { card: this.card(), claims };
  }

  async submit(tenantId: string, userId: string, dto: { plan: string; forMonth: string; note?: string; receiptFile: string }) {
    if (!this.card()) throw new BadRequestException("Karta orqali to'lov hozircha yoqilmagan");
    if (!/^\d{4}-\d{2}$/.test(dto.forMonth ?? '')) throw new BadRequestException("Oy noto'g'ri");
    const plan = await this.plans.getByKey(dto.plan).catch(() => null);
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    if (plan.price <= 0) throw new BadRequestException("Bepul tarif uchun to'lov kerak emas");

    const [paid] = await this.db
      .select({ id: platformSubscriptions.id })
      .from(platformSubscriptions)
      .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.forMonth, dto.forMonth), eq(platformSubscriptions.status, 'PAID')));
    if (paid) throw new ConflictException({ code: 'ALREADY_PAID', message: "Bu oy uchun to'lov allaqachon qilingan" });
    const [pending] = await this.db
      .select({ id: platformPaymentClaims.id })
      .from(platformPaymentClaims)
      .where(and(eq(platformPaymentClaims.tenantId, tenantId), eq(platformPaymentClaims.forMonth, dto.forMonth), eq(platformPaymentClaims.status, 'PENDING')));
    if (pending) throw new ConflictException({ code: 'PENDING', message: "Bu oy uchun yuborilgan chek hali tekshirilmoqda" });

    const [claim] = await this.db
      .insert(platformPaymentClaims)
      .values({ tenantId, plan: plan.key, forMonth: dto.forMonth, amount: plan.price, receiptFile: dto.receiptFile, note: dto.note?.trim().slice(0, 500) || null, sentByUserId: userId })
      .returning();
    this.audit.log({ tenantId, userId, action: 'create', entityType: 'platform_payment_claim', entityId: claim.id, meta: { plan: plan.key, forMonth: dto.forMonth, amount: plan.price } });
    // Told in the background: a Telegram or mail hiccup never loses the receipt.
    void this.tellPlatform(tenantId, plan.name, plan.price, dto.forMonth).catch((err) => this.logger.warn(`notice: ${(err as Error).message}`));
    return claim;
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

  async list(status?: string) {
    const rows = await this.db
      .select({ c: platformPaymentClaims, centerName: tenants.name, subdomain: tenants.subdomain, reviewedBy: users.fullName })
      .from(platformPaymentClaims)
      .innerJoin(tenants, eq(tenants.id, platformPaymentClaims.tenantId))
      .leftJoin(users, eq(users.id, platformPaymentClaims.reviewedByUserId))
      .where(status && ['PENDING', 'CONFIRMED', 'REJECTED'].includes(status) ? eq(platformPaymentClaims.status, status) : undefined)
      .orderBy(desc(platformPaymentClaims.createdAt))
      .limit(200);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(platformPaymentClaims).where(eq(platformPaymentClaims.status, 'PENDING'));
    return { pending: n, card: this.card(), items: rows.map((r) => ({ ...r.c, centerName: r.centerName, subdomain: r.subdomain, reviewedBy: r.reviewedBy })) };
  }

  /** The receipt's path on disk, for the platform admin's own download. */
  async receiptPath(id: string) {
    const [c] = await this.db.select({ file: platformPaymentClaims.receiptFile }).from(platformPaymentClaims).where(eq(platformPaymentClaims.id, id));
    const path = c ? join(UPLOAD_DIR, c.file) : null;
    if (!path || !existsSync(path)) throw new NotFoundException('Chek topilmadi');
    return { path, name: c!.file };
  }

  /**
   * The money arrived: the month is recorded paid as a provider's payment
   * would be (the center's paid time grows, a center held for non-payment
   * comes back). Claimed first, so two presses record one month.
   */
  async confirm(actorId: string, id: string) {
    const [claim] = await this.db
      .update(platformPaymentClaims)
      .set({ status: 'CONFIRMED', reviewedByUserId: actorId, reviewedAt: new Date() })
      .where(and(eq(platformPaymentClaims.id, id), eq(platformPaymentClaims.status, 'PENDING')))
      .returning();
    if (!claim) throw new ConflictException("Bu chek allaqachon ko'rib chiqilgan yoki topilmadi");
    let sub: typeof platformSubscriptions.$inferSelect;
    try {
      sub = await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`platform-pay:${claim.tenantId}`}))`);
        const [existing] = await tx
          .select()
          .from(platformSubscriptions)
          .where(and(eq(platformSubscriptions.tenantId, claim.tenantId), eq(platformSubscriptions.forMonth, claim.forMonth)))
          .for('update');
        if (existing?.status === 'PAID') throw new ConflictException("Bu oy uchun to'lov allaqachon qayd etilgan");
        const values = { plan: claim.plan, amount: claim.amount, status: 'CREATED' as const, provider: null, providerTxId: null, providerCreatedAt: null, cancelledAt: null, cancelReason: null };
        const [invoice] = existing
          ? await tx.update(platformSubscriptions).set(values).where(eq(platformSubscriptions.id, existing.id)).returning()
          : await tx.insert(platformSubscriptions).values({ tenantId: claim.tenantId, forMonth: claim.forMonth, ...values }).returning();
        const r = await applyPayment(tx, invoice.id);
        return r.sub!;
      });
    } catch (err) {
      await this.db.update(platformPaymentClaims).set({ status: 'PENDING', reviewedByUserId: null, reviewedAt: null }).where(eq(platformPaymentClaims.id, id));
      throw err;
    }
    await this.db.update(platformPaymentClaims).set({ subscriptionId: sub.id }).where(eq(platformPaymentClaims.id, id));
    this.audit.log({ tenantId: claim.tenantId, userId: actorId, action: 'create', entityType: 'platform_payment', entityId: sub.id, meta: { forMonth: claim.forMonth, plan: claim.plan, amount: claim.amount, card: true, claim: id } });
    void this.tellCenter(claim.tenantId, `✅ ${claim.forMonth} oyi uchun ${money(claim.amount)} so'm to'lovingiz tasdiqlandi. Obuna ${sub.periodEnd?.toISOString().slice(0, 10)} gacha uzaytirildi. Rahmat!`).catch(() => undefined);
    return { id, status: 'CONFIRMED', subscriptionId: sub.id, paidUntil: sub.periodEnd };
  }

  async reject(actorId: string, id: string, reason: string) {
    const why = (reason ?? '').trim().slice(0, 300);
    if (!why) throw new BadRequestException('Rad etish sababini yozing');
    const [claim] = await this.db
      .update(platformPaymentClaims)
      .set({ status: 'REJECTED', rejectReason: why, reviewedByUserId: actorId, reviewedAt: new Date() })
      .where(and(eq(platformPaymentClaims.id, id), eq(platformPaymentClaims.status, 'PENDING')))
      .returning();
    if (!claim) throw new ConflictException("Bu chek allaqachon ko'rib chiqilgan yoki topilmadi");
    this.audit.log({ tenantId: claim.tenantId, userId: actorId, action: 'update', entityType: 'platform_payment_claim', entityId: id, meta: { rejected: why } });
    void this.tellCenter(claim.tenantId, `❌ ${claim.forMonth} oyi uchun karta to'lovi tasdiqlanmadi: ${why}`).catch(() => undefined);
    return { id, status: 'REJECTED' };
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

