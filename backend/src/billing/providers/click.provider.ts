import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PaymentGatewayProvider } from './payment-gateway.interface';

export const CLICK_ERROR = {
  SUCCESS: 0,
  SIGN_FAILED: -1,
  AMOUNT_MISMATCH: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  TRANSACTION_NOT_FOUND: -6,
  FAILED_TO_UPDATE: -7,
};

function md5(input: string): string {
  return createHash('md5').update(input).digest('hex');
}

export interface ClickWebhookBody {
  click_trans_id: string;
  service_id: string;
  click_paydoc_id?: string;
  merchant_trans_id: string;
  amount: string | number;
  action: string;
  error?: string | number;
  error_note?: string;
  sign_time: string;
  sign_string: string;
  merchant_prepare_id?: string;
}

@Injectable()
export class ClickPaymentProvider implements PaymentGatewayProvider {
  readonly providerName = 'CLICK' as const;
  private readonly logger = new Logger(ClickPaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  generateCheckoutUrl(params: {
    merchantId: string;
    serviceId?: string;
    transactionId: string;
    amount: number;
  }): string {
    const serviceId = params.serviceId || this.config.get<string>('CLICK_SERVICE_ID');
    return `https://my.click.uz/services/pay?service_id=${serviceId}&merchant_id=${params.merchantId}&amount=${params.amount}&transaction_param=${params.transactionId}`;
  }

  verifySignature(body: ClickWebhookBody, secret: string): boolean {
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

    const raw =
      action === '0'
        ? `${click_trans_id}${service_id}${secret}${merchant_trans_id}${amount}${action}${sign_time}`
        : `${click_trans_id}${service_id}${secret}${merchant_trans_id}${merchant_prepare_id || ''}${amount}${action}${sign_time}`;

    const expectedSign = md5(raw);
    return expectedSign.toLowerCase() === (sign_string || '').toLowerCase();
  }

  async handleWebhook(payload: ClickWebhookBody): Promise<any> {
    // Concrete handling is orchestrated via BillingService with database access
    return payload;
  }
}
