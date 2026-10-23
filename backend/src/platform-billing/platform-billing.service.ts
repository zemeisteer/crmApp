import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { platformSubscriptions } from '../db/schema';
import { GeneratePlatformLinkDto } from './dto/platform-billing.dto';
import { PlansService } from '../plans/plans.service';
import { applyPayment, reversePayment } from './billing-period';

function md5(input: string) {
  return createHash('md5').update(input).digest('hex');
}
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// Payme's codes (JSON-RPC errors and transaction states).
const PAYME = {
  ACCESS_DENIED: -32504,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TX_NOT_FOUND: -31003,
  CANT_PERFORM: -31008,
  ACCOUNT_NOT_FOUND: -31050,
  ACCOUNT_BUSY: -31051, // another transaction is open for it, or it is paid
} as const;
// A Payme transaction not performed within 12 hours is cancelled.
const PAYME_TIMEOUT_MS = 12 * 3_600_000;
const CLICK = { SIGN: -1, AMOUNT: -2, ACTION: -3, ALREADY_PAID: -4, NOT_FOUND: -6, CANCELLED: -9 } as const;

/**
 * The center pays CRMAPP (never mixed with student -> center payments, which
 * are billing/). An invoice per month label; a payment adds a month to the
 * center's paid time (billing-period.ts). Click and Payme callbacks follow
 * their providers' state machines: the signature and the amount are checked,
 * one transaction per invoice, retries answer the same and change nothing,
 * a cancel after payment takes the month back.
 */
@Injectable()
export class PlatformBillingService {
  private readonly logger = new Logger('PlatformBilling');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  private async priceFor(planKey: string) {
    const plan = await this.plansService.getByKey(planKey).catch(() => null);
    if (!plan) throw new NotFoundException('Tarif topilmadi');
    return plan.price;
  }

  /**
   * The invoice for this month label, ready for a new payment: a paid one is
   * never reopened (409 ALREADY_PAID), nor one a provider is paying now.
   */
  private async openInvoice(tenantId: string, dto: GeneratePlatformLinkDto, provider: 'CLICK' | 'PAYME') {
    const amount = await this.priceFor(dto.plan);
    return this.db.transaction(async (tx) => {
      const [existing] = await tx.select().from(platformSubscriptions)
        .where(and(eq(platformSubscriptions.tenantId, tenantId), eq(platformSubscriptions.forMonth, dto.forMonth)))
        .for('update');
      if (existing?.status === 'PAID') {
        throw new ConflictException({ code: 'ALREADY_PAID', message: "Bu oy uchun to'lov allaqachon qilingan" });
      }
      if (existing?.status === 'PENDING' && existing.providerCreatedAt && Date.now() - existing.providerCreatedAt.getTime() < PAYME_TIMEOUT_MS) {
        throw new ConflictException({ code: 'PAYMENT_IN_PROGRESS', message: "Bu oy uchun to'lov hozir amalga oshirilmoqda. Birozdan so'ng urinib ko'ring." });
      }
      const fresh = { plan: dto.plan, amount, provider, status: 'CREATED' as const, providerTxId: null, providerCreatedAt: null, cancelledAt: null, cancelReason: null };
      const [sub] = existing
        ? await tx.update(platformSubscriptions).set(fresh).where(eq(platformSubscriptions.id, existing.id)).returning()
        : await tx.insert(platformSubscriptions).values({ tenantId, forMonth: dto.forMonth, ...fresh }).returning();
      return sub;
    });
  }

  async generateClickLink(tenantId: string, dto: GeneratePlatformLinkDto) {
    const merchantId = this.config.get<string>('PLATFORM_CLICK_MERCHANT_ID');
    const serviceId = this.config.get<string>('PLATFORM_CLICK_SERVICE_ID');
    if (!merchantId || !serviceId) {
      throw new ServiceUnavailableException(
        "Platforma Click integratsiyasi sozlanmagan: PLATFORM_CLICK_MERCHANT_ID / PLATFORM_CLICK_SERVICE_ID",
      );
    }
    const sub = await this.openInvoice(tenantId, dto, 'CLICK');
    const url = `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${sub.amount}&transaction_param=${sub.id}`;
    return { url, subscriptionId: sub.id, amount: sub.amount };
  }

  async generatePaymeLink(tenantId: string, dto: GeneratePlatformLinkDto) {
    const merchantId = this.config.get<string>('PLATFORM_PAYME_MERCHANT_ID');
    if (!merchantId) {
      throw new ServiceUnavailableException("Platforma Payme integratsiyasi sozlanmagan: PLATFORM_PAYME_MERCHANT_ID");
    }
    const sub = await this.openInvoice(tenantId, dto, 'PAYME');
    const params = `m=${merchantId};ac.transaction_param=${sub.id};a=${sub.amount * 100}`;
    const url = `https://checkout.paycom.uz/${Buffer.from(params).toString('base64')}`;
    return { url, subscriptionId: sub.id, amount: sub.amount };
  }

  // ---- Click (prepare: action 0, complete: action 1) ----
  async handleClickWebhook(body: Record<string, string>) {
    const secret = this.config.get<string>('PLATFORM_CLICK_SECRET_KEY');
    if (!secret) return { error: CLICK.ACTION, error_note: "Platforma Click sozlanmagan" };

    const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string, merchant_prepare_id } = body;
    const expected =
      action === '0'
        ? md5(`${click_trans_id}${service_id}${secret}${merchant_trans_id}${amount}${action}${sign_time}`)
        : md5(`${click_trans_id}${service_id}${secret}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`);
    if (!sign_string || !sameText(expected, sign_string)) {
      return { click_trans_id, merchant_trans_id, error: CLICK.SIGN, error_note: 'SIGN CHECK FAILED' };
    }
    const sub = await this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, merchant_trans_id) });
    if (!sub) return { click_trans_id, merchant_trans_id, error: CLICK.NOT_FOUND, error_note: 'Transaction not found' };
    if (Number(amount) !== sub.amount) return { click_trans_id, merchant_trans_id, error: CLICK.AMOUNT, error_note: 'Incorrect amount' };
    if (sub.status === 'PAID') return { click_trans_id, merchant_trans_id, error: CLICK.ALREADY_PAID, error_note: 'Already paid' };
    if (sub.status === 'CANCELLED') return { click_trans_id, merchant_trans_id, error: CLICK.CANCELLED, error_note: 'Transaction cancelled' };

    if (action === '0') {
      return { click_trans_id, merchant_trans_id, merchant_prepare_id: sub.id, error: 0, error_note: 'Success' };
    }
    if (action === '1') {
      if (merchant_prepare_id !== sub.id) return { click_trans_id, merchant_trans_id, error: CLICK.NOT_FOUND, error_note: 'Transaction not found' };
      // Click reports a payment that failed on its side with error < 0.
      if (Number(body.error ?? 0) < 0) {
        await this.db.transaction((tx) => reversePayment(tx, sub.id));
        return { click_trans_id, merchant_trans_id, error: CLICK.CANCELLED, error_note: 'Transaction cancelled' };
      }
      const r = await this.db.transaction((tx) => applyPayment(tx, sub.id, new Date(), { providerTxId: click_trans_id }));
      if (r.outcome === 'ALREADY_PAID') return { click_trans_id, merchant_trans_id, error: CLICK.ALREADY_PAID, error_note: 'Already paid' };
      if (r.outcome !== 'PAID') return { click_trans_id, merchant_trans_id, error: CLICK.CANCELLED, error_note: 'Transaction cancelled' };
      this.logger.log(`Platform payment ${sub.id} (Click) applied`);
      return { click_trans_id, merchant_trans_id, merchant_confirm_id: sub.id, error: 0, error_note: 'Success' };
    }
    return { click_trans_id, merchant_trans_id, error: CLICK.ACTION, error_note: 'Action not found' };
  }

  // ---- Payme (JSON-RPC 2.0) ----
  async handlePaymeWebhook(authHeader: string | undefined, body: any) {
    const key = this.config.get<string>('PLATFORM_PAYME_KEY');
    const expected = 'Basic ' + Buffer.from(`Paycom:${key}`).toString('base64');
    if (!key || !authHeader || !sameText(authHeader, expected)) {
      return { error: { code: PAYME.ACCESS_DENIED, message: 'Insufficient privilege' }, id: body?.id };
    }
    const { method, params, id } = body ?? {};
    const fail = (code: number, message: string) => ({ error: { code, message }, id });
    const byTx = () => this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.providerTxId, String(params?.id ?? '')) });
    const state = (s: typeof platformSubscriptions.$inferSelect) =>
      s.status === 'PAID' ? 2 : s.status === 'CANCELLED' ? (s.paidAt ? -2 : -1) : 1;
    const ms = (d: Date | null) => (d ? d.getTime() : 0);

    switch (method) {
      case 'CheckPerformTransaction': {
        const sub = await this.byAccount(params);
        if (!sub) return fail(PAYME.ACCOUNT_NOT_FOUND, 'Not found');
        if (params.amount !== sub.amount * 100) return fail(PAYME.INVALID_AMOUNT, 'Incorrect amount');
        if (sub.status === 'PAID' || sub.status === 'CANCELLED' || (sub.status === 'PENDING' && sub.providerTxId)) return fail(PAYME.ACCOUNT_BUSY, 'Not available');
        return { result: { allow: true }, id };
      }
      case 'CreateTransaction': {
        const sub = await this.byAccount(params);
        if (!sub) return fail(PAYME.ACCOUNT_NOT_FOUND, 'Not found');
        if (params.amount !== sub.amount * 100) return fail(PAYME.INVALID_AMOUNT, 'Incorrect amount');
        if (sub.providerTxId && sub.providerTxId === params.id && sub.provider === 'PAYME') {
          return { result: { create_time: ms(sub.providerCreatedAt), transaction: sub.id, state: state(sub) }, id };
        }
        if (sub.status !== 'CREATED') return fail(PAYME.ACCOUNT_BUSY, 'Another transaction is open or it is paid');
        const now = new Date();
        // Only a CREATED invoice is taken: two at once cannot both open it.
        const [opened] = await this.db.update(platformSubscriptions)
          .set({ status: 'PENDING', provider: 'PAYME', providerTxId: String(params.id), providerCreatedAt: now })
          .where(and(eq(platformSubscriptions.id, sub.id), eq(platformSubscriptions.status, 'CREATED')))
          .returning();
        if (!opened) return fail(PAYME.ACCOUNT_BUSY, 'Another transaction is open');
        return { result: { create_time: now.getTime(), transaction: sub.id, state: 1 }, id };
      }
      case 'PerformTransaction': {
        const sub = await byTx();
        if (!sub) return fail(PAYME.TX_NOT_FOUND, 'Not found');
        if (sub.status === 'PAID') return { result: { transaction: sub.id, perform_time: ms(sub.paidAt), state: 2 }, id };
        if (sub.status === 'CANCELLED') return fail(PAYME.CANT_PERFORM, 'Cancelled');
        if (sub.providerCreatedAt && Date.now() - sub.providerCreatedAt.getTime() > PAYME_TIMEOUT_MS) {
          await this.db.transaction((tx) => reversePayment(tx, sub.id, new Date(), 4));
          return fail(PAYME.CANT_PERFORM, 'Timed out');
        }
        const r = await this.db.transaction((tx) => applyPayment(tx, sub.id));
        if (r.outcome === 'CANCELLED') return fail(PAYME.CANT_PERFORM, 'Cancelled');
        const paid = r.sub!;
        this.logger.log(`Platform payment ${sub.id} (Payme) applied`);
        return { result: { transaction: sub.id, perform_time: ms(paid.paidAt), state: 2 }, id };
      }
      case 'CancelTransaction': {
        const sub = await byTx();
        if (!sub) return fail(PAYME.TX_NOT_FOUND, 'Not found');
        const r = await this.db.transaction((tx) => reversePayment(tx, sub.id, new Date(), typeof params.reason === 'number' ? params.reason : undefined));
        const after = r.sub!;
        if (r.outcome === 'REVERSED') this.logger.warn(`Platform payment ${sub.id} (Payme) cancelled after payment: the month is taken back`);
        return { result: { transaction: sub.id, cancel_time: ms(after.cancelledAt), state: state(after) }, id };
      }
      case 'CheckTransaction': {
        const sub = await byTx();
        if (!sub) return fail(PAYME.TX_NOT_FOUND, 'Not found');
        return {
          result: {
            transaction: sub.id,
            state: state(sub),
            create_time: ms(sub.providerCreatedAt),
            perform_time: ms(sub.paidAt),
            cancel_time: ms(sub.cancelledAt),
            reason: sub.cancelReason ?? null,
          },
          id,
        };
      }
      default:
        return fail(PAYME.METHOD_NOT_FOUND, 'Method not found');
    }
  }

  private byAccount(params: { account?: { transaction_param?: string } } | undefined) {
    const subId = params?.account?.transaction_param;
    if (!subId) return Promise.resolve(undefined);
    return this.db.query.platformSubscriptions.findFirst({ where: eq(platformSubscriptions.id, String(subId)) });
  }
}
