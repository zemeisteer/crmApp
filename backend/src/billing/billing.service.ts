import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { billingTransactions, payments, students } from '../db/schema';
import { GeneratePaymentLinkDto } from './dto/billing.dto';
import { NotificationsService } from '../notifications/notifications.service';

// NOTE: Click and Payme's exact field names / error codes have shifted
// across their API versions over the years. This module implements the
// commonly-documented Click Merchant API v2 (Prepare/Complete) and Payme
// Business API (JSON-RPC) contracts as a working starting point — verify
// against your live merchant dashboard's current docs and test in their
// sandbox before accepting real payments.

function md5(input: string) {
  return createHash('md5').update(input).digest('hex');
}

const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_FAILED: -1,
  AMOUNT_MISMATCH: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  TRANSACTION_NOT_FOUND: -6,
};

@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
  ) {}

  getConfig() {
    return {
      clickEnabled: Boolean(
        this.config.get<string>('CLICK_MERCHANT_ID') && this.config.get<string>('CLICK_SERVICE_ID'),
      ),
      paymeEnabled: Boolean(this.config.get<string>('PAYME_MERCHANT_ID')),
    };
  }

  private async createPendingTx(tenantId: string, dto: GeneratePaymentLinkDto, provider: 'CLICK' | 'PAYME') {
    const student = await this.db.query.students.findFirst({
      where: and(eq(students.id, dto.studentId), eq(students.tenantId, tenantId)),
    });
    if (!student) {
      throw new NotFoundException('O\'quvchi topilmadi');
    }

    const [tx] = await this.db
      .insert(billingTransactions)
      .values({
        tenantId,
        studentId: dto.studentId,
        provider,
        amount: dto.amount,
        forMonth: dto.forMonth,
        status: 'CREATED',
      })
      .returning();
    return tx;
  }

  async generateClickLink(tenantId: string, dto: GeneratePaymentLinkDto) {
    const merchantId = this.config.get<string>('CLICK_MERCHANT_ID');
    const serviceId = this.config.get<string>('CLICK_SERVICE_ID');
    if (!merchantId || !serviceId) {
      throw new ServiceUnavailableException("Click integratsiyasi sozlanmagan: CLICK_MERCHANT_ID / CLICK_SERVICE_ID");
    }
    const tx = await this.createPendingTx(tenantId, dto, 'CLICK');
    const url = `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${merchantId}&amount=${dto.amount}&transaction_param=${tx.id}`;
    return { url, transactionId: tx.id };
  }

  async generatePaymeLink(tenantId: string, dto: GeneratePaymentLinkDto) {
    const merchantId = this.config.get<string>('PAYME_MERCHANT_ID');
    if (!merchantId) {
      throw new ServiceUnavailableException("Payme integratsiyasi sozlanmagan: PAYME_MERCHANT_ID");
    }
    const tx = await this.createPendingTx(tenantId, dto, 'PAYME');
    const amountTiyin = dto.amount * 100;
    const params = `m=${merchantId};ac.transaction_param=${tx.id};a=${amountTiyin}`;
    const encoded = Buffer.from(params).toString('base64');
    const url = `https://checkout.paycom.uz/${encoded}`;
    return { url, transactionId: tx.id };
  }

  private async finalizePayment(txId: string) {
    const tx = await this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId) });
    if (!tx) return null;
    if (tx.status === 'PAID') return tx;

    const [payment] = await this.db
      .insert(payments)
      .values({
        tenantId: tx.tenantId,
        studentId: tx.studentId,
        amount: tx.amount,
        method: tx.provider,
        status: 'PAID',
        forMonth: tx.forMonth,
      })
      .returning();

    const [updated] = await this.db
      .update(billingTransactions)
      .set({ status: 'PAID', paymentId: payment.id, updatedAt: new Date() })
      .where(eq(billingTransactions.id, txId))
      .returning();

    void this.telegram.notifyStudent(
      tx.studentId,
      `To'lov qabul qilindi: ${new Intl.NumberFormat('uz-UZ').format(tx.amount)} so'm (${tx.forMonth} oyi uchun, ${tx.provider}).`,
    );

    void this.notifications.notifyPaymentReceived(
      tx.tenantId,
      tx.studentId,
      tx.amount,
      tx.forMonth,
    );

    return updated;
  }

  // ---- Click webhook (single endpoint, action 0 = Prepare, 1 = Complete) ----
  async handleClickWebhook(body: Record<string, string>) {
    const secret = this.config.get<string>('CLICK_SECRET_KEY');
    if (!secret) {
      return { error: CLICK_ERROR.ACTION_NOT_FOUND, error_note: 'Click sozlanmagan' };
    }

    const { click_trans_id, service_id, merchant_trans_id, amount, action, sign_time, sign_string, merchant_prepare_id } =
      body;

    const expectedSign =
      action === '0'
        ? md5(`${click_trans_id}${service_id}${secret}${merchant_trans_id}${amount}${action}${sign_time}`)
        : md5(
            `${click_trans_id}${service_id}${secret}${merchant_trans_id}${merchant_prepare_id}${amount}${action}${sign_time}`,
          );

    if (expectedSign !== sign_string) {
      return { click_trans_id, merchant_trans_id, error: CLICK_ERROR.SIGN_FAILED, error_note: 'SIGN CHECK FAILED' };
    }

    const tx = await this.db.query.billingTransactions.findFirst({
      where: eq(billingTransactions.id, merchant_trans_id),
    });
    if (!tx) {
      return { click_trans_id, merchant_trans_id, error: CLICK_ERROR.TRANSACTION_NOT_FOUND, error_note: 'Transaction not found' };
    }
    if (Number(amount) !== tx.amount) {
      return { click_trans_id, merchant_trans_id, error: CLICK_ERROR.AMOUNT_MISMATCH, error_note: 'Incorrect amount' };
    }
    if (tx.status === 'PAID') {
      return { click_trans_id, merchant_trans_id, error: CLICK_ERROR.ALREADY_PAID, error_note: 'Already paid' };
    }

    if (action === '0') {
      await this.db
        .update(billingTransactions)
        .set({ providerTxId: click_trans_id, updatedAt: new Date() })
        .where(eq(billingTransactions.id, tx.id));
      return {
        click_trans_id,
        merchant_trans_id,
        merchant_prepare_id: tx.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: 'Success',
      };
    }

    if (action === '1') {
      await this.finalizePayment(tx.id);
      return {
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: tx.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: 'Success',
      };
    }

    return { click_trans_id, merchant_trans_id, error: CLICK_ERROR.ACTION_NOT_FOUND, error_note: 'Action not found' };
  }

  // ---- Payme webhook (JSON-RPC 2.0) ----
  async handlePaymeWebhook(authHeader: string | undefined, body: any) {
    const key = this.config.get<string>('PAYME_KEY');
    const expected = 'Basic ' + Buffer.from(`Paycom:${key}`).toString('base64');
    if (!key || authHeader !== expected) {
      return { error: { code: -32504, message: 'Insufficient privilege' }, id: body?.id };
    }

    const { method, params, id } = body;
    const txId: string | undefined = params?.account?.transaction_param;

    switch (method) {
      case 'CheckPerformTransaction': {
        if (!txId) return { error: { code: -31050, message: 'transaction_param required' }, id };
        const tx = await this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId) });
        if (!tx) return { error: { code: -31050, message: 'Transaction not found' }, id };
        if (params.amount !== tx.amount * 100) return { error: { code: -31001, message: 'Incorrect amount' }, id };
        return { result: { allow: true }, id };
      }
      case 'CreateTransaction': {
        const tx = await this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId!) });
        if (!tx) return { error: { code: -31050, message: 'Transaction not found' }, id };
        await this.db
          .update(billingTransactions)
          .set({ providerTxId: params.id, updatedAt: new Date() })
          .where(eq(billingTransactions.id, tx.id));
        return { result: { create_time: Date.now(), transaction: tx.id, state: 1 }, id };
      }
      case 'PerformTransaction': {
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
        if (!tx) return { error: { code: -31003, message: 'Transaction not found' }, id };
        await this.finalizePayment(tx.id);
        return { result: { transaction: tx.id, perform_time: Date.now(), state: 2 }, id };
      }
      case 'CancelTransaction': {
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
        if (!tx) return { error: { code: -31003, message: 'Transaction not found' }, id };
        await this.db
          .update(billingTransactions)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(eq(billingTransactions.id, tx.id));
        return { result: { transaction: tx.id, cancel_time: Date.now(), state: -1 }, id };
      }
      case 'CheckTransaction': {
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
        if (!tx) return { error: { code: -31003, message: 'Transaction not found' }, id };
        return {
          result: {
            transaction: tx.id,
            state: tx.status === 'PAID' ? 2 : tx.status === 'CANCELLED' ? -1 : 1,
            create_time: new Date(tx.createdAt).getTime(),
            perform_time: tx.status === 'PAID' ? new Date(tx.updatedAt).getTime() : 0,
            cancel_time: tx.status === 'CANCELLED' ? new Date(tx.updatedAt).getTime() : 0,
          },
          id,
        };
      }
      default:
        return { error: { code: -32601, message: 'Method not found' }, id };
    }
  }
}
