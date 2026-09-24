import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, ne } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { billingTransactions, invoices, paymentAllocations, payments, students } from '../db/schema';
import { GeneratePaymentLinkDto } from './dto/billing.dto';
import { TelegramService } from '../telegram/telegram.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { CLICK_ERROR, ClickPaymentProvider } from './providers/click.provider';
import { PAYME_ERROR, PaymePaymentProvider } from './providers/payme.provider';

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
  ) {}

  getConfig() {
    return {
      clickEnabled: Boolean(
        this.config.get<string>('CLICK_MERCHANT_ID') && this.config.get<string>('CLICK_SERVICE_ID'),
      ),
      paymeEnabled: Boolean(this.config.get<string>('PAYME_MERCHANT_ID')),
    };
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
    const merchantId = this.config.get<string>('CLICK_MERCHANT_ID');
    const serviceId = this.config.get<string>('CLICK_SERVICE_ID');
    if (!merchantId || !serviceId) {
      throw new ServiceUnavailableException(
        'Click integratsiyasi sozlanmagan: CLICK_MERCHANT_ID / CLICK_SERVICE_ID',
      );
    }
    const tx = await this.createPendingTx(tenantId, dto, 'CLICK');
    const url = this.clickProvider.generateCheckoutUrl({
      merchantId,
      serviceId,
      transactionId: tx.id,
      amount: dto.amount,
    });
    return { url, transactionId: tx.id };
  }

  async generatePaymeLink(tenantId: string, dto: GeneratePaymentLinkDto) {
    const merchantId = this.config.get<string>('PAYME_MERCHANT_ID');
    if (!merchantId) {
      throw new ServiceUnavailableException(
        'Payme integratsiyasi sozlanmagan: PAYME_MERCHANT_ID',
      );
    }
    const tx = await this.createPendingTx(tenantId, dto, 'PAYME');
    const url = this.paymeProvider.generateCheckoutUrl({
      merchantId,
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

    // Under concurrent webhook deliveries for the same transaction, only the
    // request whose UPDATE actually flips a non-PAID row wins the race —
    // every other concurrent caller sees an empty result and returns the
    // already-finalized transaction instead of inserting a duplicate payment.
    const [claimed] = await this.db
      .update(billingTransactions)
      .set({ status: 'PAID', updatedAt: new Date() })
      .where(and(eq(billingTransactions.id, txId), ne(billingTransactions.status, 'PAID')))
      .returning();
    if (!claimed) {
      return this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId) });
    }

    if (providerTxId) {
      const existingPayment = await this.db.query.payments.findFirst({
        where: and(
          eq(payments.tenantId, tx.tenantId),
          eq(payments.providerTxId, providerTxId),
        ),
      });
      if (existingPayment) {
        return this.db.query.billingTransactions.findFirst({ where: eq(billingTransactions.id, txId) });
      }
    }

    const receiptNumber = `RCP-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100000 + Math.random() * 900000)}`;

    const [payment] = await this.db
      .insert(payments)
      .values({
        tenantId: tx.tenantId,
        studentId: tx.studentId,
        invoiceId: tx.invoiceId,
        amount: tx.amount,
        method: tx.provider,
        status: 'PAID',
        forMonth: tx.forMonth,
        providerTxId: providerTxId || tx.providerTxId || null,
        receiptNumber,
      })
      .returning();

    // Allocate payment to invoice if invoiceId is set or if there's an open invoice for this month
    let targetInvoiceId = tx.invoiceId;
    if (!targetInvoiceId) {
      const openInv = await this.db.query.invoices.findFirst({
        where: and(
          eq(invoices.tenantId, tx.tenantId),
          eq(invoices.studentId, tx.studentId),
          eq(invoices.forMonth, tx.forMonth),
        ),
      });
      if (openInv && openInv.status !== 'CANCELLED' && openInv.remainingAmount > 0) {
        targetInvoiceId = openInv.id;
      }
    }

    if (targetInvoiceId) {
      const inv = await this.db.query.invoices.findFirst({
        where: eq(invoices.id, targetInvoiceId),
      });
      if (inv && inv.status !== 'CANCELLED') {
        const allocAmount = Math.min(tx.amount, inv.remainingAmount);
        await this.db.insert(paymentAllocations).values({
          tenantId: tx.tenantId,
          paymentId: payment.id,
          invoiceId: inv.id,
          amount: allocAmount,
        });

        const newPaid = inv.amountPaid + allocAmount;
        const newRemaining = Math.max(0, inv.remainingAmount - allocAmount);
        const newStatus = newRemaining === 0 ? 'PAID' : 'PARTIALLY_PAID';

        await this.db
          .update(invoices)
          .set({
            amountPaid: newPaid,
            remainingAmount: newRemaining,
            status: newStatus,
            paidAt: newRemaining === 0 ? new Date() : inv.paidAt,
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, inv.id));
      }
    }

    const [updated] = await this.db
      .update(billingTransactions)
      .set({
        status: 'PAID',
        paymentId: payment.id,
        providerTxId: providerTxId || tx.providerTxId,
        updatedAt: new Date(),
      })
      .where(eq(billingTransactions.id, txId))
      .returning();

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
  async handleClickWebhook(body: Record<string, string>) {
    const secret = this.config.get<string>('CLICK_SECRET_KEY');
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

    const tx = await this.db.query.billingTransactions.findFirst({
      where: eq(billingTransactions.id, merchant_trans_id),
    });
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
  async handlePaymeWebhook(authHeader: string | undefined, body: any) {
    const key = this.config.get<string>('PAYME_KEY');
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
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.id, txId),
        });
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
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.id, txId),
        });
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
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
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
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
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
        const tx = await this.db.query.billingTransactions.findFirst({
          where: eq(billingTransactions.providerTxId, params.id),
        });
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
