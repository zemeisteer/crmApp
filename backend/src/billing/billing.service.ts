import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, ne, type SQL } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { billingTransactions, invoices, payments, students } from '../db/schema';
import { allocateToInvoices, lockInvoice, lockOpenInvoices, lockStudentLedger } from '../payments/allocation';
import { GeneratePaymentLinkDto } from './dto/billing.dto';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { CLICK_ERROR, ClickPaymentProvider } from './providers/click.provider';
import { PAYME_ERROR, PaymePaymentProvider } from './providers/payme.provider';
import { type GatewayCredentials, type GatewayProvider, PaymentAccountsService } from './payment-accounts.service';

/**
 * Whose callback this is. A center's own route (`/webhook/:tenantId`) is
 * checked with that center's key and sees only its transactions. The old
 * shared route is checked with the platform-wide key and never touches a
 * center that has its own account.
 */
type Scope = { tenantId: string } | null;

@Injectable()
export class BillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly telegram: TelegramService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly clickProvider: ClickPaymentProvider,
    private readonly paymeProvider: PaymePaymentProvider,
    private readonly accounts: PaymentAccountsService,
  ) {}

  /** Which online payments this center can take (its own account, or the platform's). */
  async getConfig(tenantId: string) {
    const [click, payme] = await Promise.all([this.accounts.resolve(tenantId, 'CLICK'), this.accounts.resolve(tenantId, 'PAYME')]);
    return { clickEnabled: Boolean(click), paymeEnabled: Boolean(payme) };
  }

  private notConnected(name: string) {
    return new ServiceUnavailableException(`${name} ulanmagan: markaz admini Sozlamalar → "Onlayn to'lovlar" bo'limida o'z ${name} hisobini qo'shishi kerak.`);
  }

  /** The callback's credentials: the center's own on its route, the platform's on the shared one. */
  private async callbackCredentials(scope: Scope, provider: GatewayProvider): Promise<GatewayCredentials | null> {
    return scope ? this.accounts.own(scope.tenantId, provider) : this.accounts.platform(provider);
  }

  /** A transaction the callback may act on (see Scope). */
  private async findTx(where: SQL, scope: Scope, provider: GatewayProvider) {
    const tx = await this.db.query.billingTransactions.findFirst({
      where: scope ? and(where, eq(billingTransactions.tenantId, scope.tenantId)) : where,
    });
    if (!tx) return undefined;
    if (!scope && (await this.accounts.hasOwn(tx.tenantId, provider))) return undefined;
    return tx;
  }

  private async createPendingTx(
    tenantId: string,
    dto: GeneratePaymentLinkDto,
    provider: 'CLICK' | 'PAYME',
  ) {
    const student = await this.db.query.students.findFirst({
      where: and(
        eq(students.id, dto.studentId),
        eq(students.tenantId, tenantId),
      ),
    });
    if (!student) {
      throw new NotFoundException("O'quvchi topilmadi");
    }

    let invoiceId: string | null = null;
    if (dto.invoiceId) {
      const inv = await this.db.query.invoices.findFirst({
        where: and(
          eq(invoices.id, dto.invoiceId),
          eq(invoices.tenantId, tenantId),
          eq(invoices.studentId, dto.studentId),
        ),
      });
      if (!inv) {
        throw new NotFoundException('Hisob-faktura topilmadi');
      }
      if (inv.status === 'CANCELLED') {
        throw new BadRequestException("Bekor qilingan hisob-faktura uchun to'lov qabul qilib bo'lmaydi");
      }
      if (dto.amount > inv.remainingAmount) {
        throw new BadRequestException(
          `To'lov summasi (${dto.amount}) hisob-fakturaning qoldiq summasidan (${inv.remainingAmount}) oshib ketishi mumkin emas`,
        );
      }
      invoiceId = inv.id;
    }

    const [tx] = await this.db
      .insert(billingTransactions)
      .values({
        tenantId,
        studentId: dto.studentId,
        invoiceId,
        provider,
        amount: dto.amount,
        forMonth: dto.forMonth,
        status: 'CREATED',
      })
      .returning();
    return tx;
  }

  async generateClickLink(tenantId: string, dto: GeneratePaymentLinkDto) {
    const acc = await this.accounts.resolve(tenantId, 'CLICK');
    if (!acc?.serviceId) throw this.notConnected('Click');
    const tx = await this.createPendingTx(tenantId, dto, 'CLICK');
    const url = this.clickProvider.generateCheckoutUrl({
      merchantId: acc.merchantId,
      serviceId: acc.serviceId,
      transactionId: tx.id,
      amount: dto.amount,
    });
    return { url, transactionId: tx.id };
  }

  async generatePaymeLink(tenantId: string, dto: GeneratePaymentLinkDto) {
    const acc = await this.accounts.resolve(tenantId, 'PAYME');
    if (!acc) throw this.notConnected('Payme');
    const tx = await this.createPendingTx(tenantId, dto, 'PAYME');
    const url = this.paymeProvider.generateCheckoutUrl({
      merchantId: acc.merchantId,
      transactionId: tx.id,
      amount: dto.amount,
    });
    return { url, transactionId: tx.id };
  }

  private readonly inFlightFinalizations = new Map<string, Promise<any>>();

  async finalizePayment(txId: string, providerTxId?: string) {
    const inFlight = this.inFlightFinalizations.get(txId);
    if (inFlight) {
      return inFlight;
    }

    const task = this.executeFinalizePayment(txId, providerTxId);
    this.inFlightFinalizations.set(txId, task);
    try {
      return await task;
    } finally {
      this.inFlightFinalizations.delete(txId);
    }
  }

  private async executeFinalizePayment(txId: string, providerTxId?: string) {
    const tx = await this.db.query.billingTransactions.findFirst({
      where: eq(billingTransactions.id, txId),
    });
    if (!tx) return null;
    if (tx.status === 'PAID') return tx;

    // One transaction: claiming the gateway transaction, the payment row,
    // its allocation to invoices and the link back either all happen or
    // none do, so a crash in the middle cannot leave a PAID transaction
    // without a payment. Under concurrent webhook deliveries only the
    // request whose UPDATE flips a non-PAID row goes on; the others get the
    // finished transaction. The student's ledger lock keeps a payment taken
    // at the desk at the same moment from using the same invoice balance.
    const receiptNumber = `RCP-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`;
    const done = await this.db.transaction(async (trx) => {
      await lockStudentLedger(trx, tx.studentId);
      const [claimed] = await trx
        .update(billingTransactions)
        .set({ status: 'PAID', updatedAt: new Date() })
        .where(and(eq(billingTransactions.id, txId), ne(billingTransactions.status, 'PAID')))
        .returning();
      if (!claimed) return null;

      if (providerTxId) {
        const existingPayment = await trx.query.payments.findFirst({
          where: and(eq(payments.tenantId, tx.tenantId), eq(payments.providerTxId, providerTxId)),
          columns: { id: true },
        });
        if (existingPayment) return null;
      }

      // The invoice the link was made for, else the month's open invoices
      // (oldest due first) - the same rule as a payment taken at the desk.
      let targets: Array<typeof invoices.$inferSelect> = [];
      if (tx.invoiceId) {
        const inv = await lockInvoice(trx, tx.tenantId, tx.studentId, tx.invoiceId);
        if (inv && inv.status !== 'CANCELLED') targets = [inv];
      } else {
        targets = await lockOpenInvoices(trx, tx.tenantId, tx.studentId, tx.forMonth);
      }

      const [payment] = await trx
        .insert(payments)
        .values({
          tenantId: tx.tenantId,
          studentId: tx.studentId,
          invoiceId: tx.invoiceId ?? targets[0]?.id ?? null,
          amount: tx.amount,
          method: tx.provider,
          status: 'PAID',
          forMonth: tx.forMonth,
          providerTxId: providerTxId || tx.providerTxId || null,
          receiptNumber,
        })
        .returning();
      await allocateToInvoices(trx, { tenantId: tx.tenantId, paymentId: payment.id, amount: tx.amount }, targets);

      const [updated] = await trx
        .update(billingTransactions)
        .set({
          status: 'PAID',
          paymentId: payment.id,
          providerTxId: providerTxId || tx.providerTxId,
          updatedAt: new Date(),
        })
        .where(eq(billingTransactions.id, txId))
        .returning();
      return { payment, updated };
    });
    if (!done) {
      return this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId) });
    }
    const { payment, updated } = done;

    this.audit.log({
      tenantId: tx.tenantId,
      userId: null,
      action: 'complete',
      entityType: 'gateway_transaction',
      entityId: tx.id,
      meta: {
        provider: tx.provider,
        providerTxId: providerTxId || tx.providerTxId,
        amount: tx.amount,
        paymentId: payment.id,
        receiptNumber,
      },
    });

    void this.telegram.notifyStudent(
      tx.studentId,
      `To'lov qabul qilindi: ${new Intl.NumberFormat('uz-UZ').format(tx.amount)} so'm (${tx.forMonth} oyi uchun, ${tx.provider}). Kvitansiya: ${receiptNumber}`,
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
  async handleClickWebhook(body: Record<string, string>, scope: Scope = null) {
    const creds = await this.callbackCredentials(scope, 'CLICK');
    const secret = creds?.secret;
    if (!secret) {
      return { error: CLICK_ERROR.ACTION_NOT_FOUND, error_note: 'Click sozlanmagan' };
    }

    const {
      click_trans_id,
      service_id,
      merchant_trans_id,
      amount,
      action,
      sign_time,
      sign_string,
      merchant_prepare_id,
    } = body;

    const validSign = this.clickProvider.verifySignature(
      {
        click_trans_id,
        service_id,
        merchant_trans_id,
        amount,
        action,
        sign_time,
        sign_string,
        merchant_prepare_id,
      },
      secret,
    );

    if (!validSign) {
      return {
        click_trans_id,
        merchant_trans_id,
        error: CLICK_ERROR.SIGN_FAILED,
        error_note: 'SIGN CHECK FAILED',
      };
    }

    const tx = await this.findTx(eq(billingTransactions.id, merchant_trans_id), scope, 'CLICK');
    if (!tx) {
      return {
        click_trans_id,
        merchant_trans_id,
        error: CLICK_ERROR.TRANSACTION_NOT_FOUND,
        error_note: 'Transaction not found',
      };
    }
    if (Number(amount) !== tx.amount) {
      return {
        click_trans_id,
        merchant_trans_id,
        error: CLICK_ERROR.AMOUNT_MISMATCH,
        error_note: 'Incorrect amount',
      };
    }

    if (action === '0') {
      if (tx.status === 'PAID') {
        if (tx.providerTxId === click_trans_id) {
          return {
            click_trans_id,
            merchant_trans_id,
            merchant_prepare_id: tx.id,
            error: CLICK_ERROR.SUCCESS,
            error_note: 'Success',
          };
        }
        return {
          click_trans_id,
          merchant_trans_id,
          error: CLICK_ERROR.ALREADY_PAID,
          error_note: 'Already paid',
        };
      }

      await this.db
        .update(billingTransactions)
        .set({
          providerTxId: click_trans_id,
          status: 'PENDING',
          updatedAt: new Date(),
        })
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
      if (tx.status === 'PAID') {
        // Idempotent retry: if same click_trans_id, return success
        if (tx.providerTxId === click_trans_id) {
          return {
            click_trans_id,
            merchant_trans_id,
            merchant_confirm_id: tx.id,
            error: CLICK_ERROR.SUCCESS,
            error_note: 'Success',
          };
        }
        return {
          click_trans_id,
          merchant_trans_id,
          error: CLICK_ERROR.ALREADY_PAID,
          error_note: 'Already paid',
        };
      }

      await this.finalizePayment(tx.id, click_trans_id);
      return {
        click_trans_id,
        merchant_trans_id,
        merchant_confirm_id: tx.id,
        error: CLICK_ERROR.SUCCESS,
        error_note: 'Success',
      };
    }

    return {
      click_trans_id,
      merchant_trans_id,
      error: CLICK_ERROR.ACTION_NOT_FOUND,
      error_note: 'Action not found',
    };
  }

  // ---- Payme webhook (JSON-RPC 2.0) ----
  async handlePaymeWebhook(authHeader: string | undefined, body: any, scope: Scope = null) {
    const key = (await this.callbackCredentials(scope, 'PAYME'))?.secret;
    if (!key || !this.paymeProvider.verifyBasicAuth(authHeader, key)) {
      return {
        error: { code: PAYME_ERROR.ACCESS_DENIED, message: 'Insufficient privilege' },
        id: body?.id,
      };
    }

    const { method, params, id } = body;
    const txId: string | undefined = params?.account?.transaction_param;

    switch (method) {
      case 'CheckPerformTransaction': {
        if (!txId) {
          return {
            error: { code: PAYME_ERROR.ACCOUNT_NOT_FOUND, message: 'transaction_param required' },
            id,
          };
        }
        const tx = await this.findTx(eq(billingTransactions.id, txId), scope, 'PAYME');
        if (!tx) {
          return {
            error: { code: PAYME_ERROR.ACCOUNT_NOT_FOUND, message: 'Transaction not found' },
            id,
          };
        }
        if (params.amount !== tx.amount * 100) {
          return {
            error: { code: PAYME_ERROR.INVALID_AMOUNT, message: 'Incorrect amount' },
            id,
          };
        }
        return { result: { allow: true }, id };
      }
      case 'CreateTransaction': {
        if (!txId) {
          return {
            error: { code: PAYME_ERROR.ACCOUNT_NOT_FOUND, message: 'transaction_param required' },
            id,
          };
        }
        const tx = await this.findTx(eq(billingTransactions.id, txId), scope, 'PAYME');
        if (!tx) {
          return {
            error: { code: PAYME_ERROR.ACCOUNT_NOT_FOUND, message: 'Transaction not found' },
            id,
          };
        }
        if (params.amount !== tx.amount * 100) {
          return {
            error: { code: PAYME_ERROR.INVALID_AMOUNT, message: 'Incorrect amount' },
            id,
          };
        }
        if (tx.providerTxId && tx.providerTxId === params.id) {
          // Idempotent CreateTransaction call
          return {
            result: {
              create_time: new Date(tx.createdAt).getTime(),
              transaction: tx.id,
              state: tx.status === 'PAID' ? 2 : 1,
            },
            id,
          };
        }
        if (tx.status === 'PAID') {
          return {
            error: { code: PAYME_ERROR.CANT_PERFORM_OPERATION, message: 'Already paid' },
            id,
          };
        }
        await this.db
          .update(billingTransactions)
          .set({
            providerTxId: params.id,
            status: 'PENDING',
            updatedAt: new Date(),
          })
          .where(eq(billingTransactions.id, tx.id));
        return {
          result: {
            create_time: Date.now(),
            transaction: tx.id,
            state: 1,
          },
          id,
        };
      }
      case 'PerformTransaction': {
        const tx = await this.findTx(eq(billingTransactions.providerTxId, params.id), scope, 'PAYME');
        if (!tx) {
          return {
            error: { code: PAYME_ERROR.TRANSACTION_NOT_FOUND, message: 'Transaction not found' },
            id,
          };
        }
        if (tx.status === 'PAID') {
          // Idempotent retry
          return {
            result: {
              transaction: tx.id,
              perform_time: new Date(tx.updatedAt).getTime(),
              state: 2,
            },
            id,
          };
        }
        await this.finalizePayment(tx.id, params.id);
        return {
          result: {
            transaction: tx.id,
            perform_time: Date.now(),
            state: 2,
          },
          id,
        };
      }
      case 'CancelTransaction': {
        const tx = await this.findTx(eq(billingTransactions.providerTxId, params.id), scope, 'PAYME');
        if (!tx) {
          return {
            error: { code: PAYME_ERROR.TRANSACTION_NOT_FOUND, message: 'Transaction not found' },
            id,
          };
        }
        if (tx.status === 'CANCELLED') {
          return {
            result: {
              transaction: tx.id,
              cancel_time: new Date(tx.updatedAt).getTime(),
              state: -1,
            },
            id,
          };
        }
        await this.db
          .update(billingTransactions)
          .set({ status: 'CANCELLED', updatedAt: new Date() })
          .where(eq(billingTransactions.id, tx.id));

        this.audit.log({
          tenantId: tx.tenantId,
          userId: null,
          action: 'cancel',
          entityType: 'gateway_transaction',
          entityId: tx.id,
          meta: { provider: 'PAYME', reason: params.reason },
        });

        return {
          result: {
            transaction: tx.id,
            cancel_time: Date.now(),
            state: -1,
          },
          id,
        };
      }
      case 'CheckTransaction': {
        const tx = await this.findTx(eq(billingTransactions.providerTxId, params.id), scope, 'PAYME');
        if (!tx) {
          return {
            error: { code: PAYME_ERROR.TRANSACTION_NOT_FOUND, message: 'Transaction not found' },
            id,
          };
        }
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
        return {
          error: { code: PAYME_ERROR.METHOD_NOT_FOUND, message: 'Method not found' },
          id,
        };
    }
  }
}
