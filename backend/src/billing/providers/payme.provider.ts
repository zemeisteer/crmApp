import { timingSafeEqual } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGatewayProvider } from './payment-gateway.interface';

export const PAYME_ERROR = {
  TRANSPORT_ERROR: -32300,
  ACCESS_DENIED: -32504,
  PARSE_ERROR: -32700,
  METHOD_NOT_FOUND: -32601,
  INVALID_AMOUNT: -31001,
  TRANSACTION_NOT_FOUND: -31003,
  // A performed transaction is not cancelled from Payme's side: the refund
  // is made by the center, so the student's payment never silently stays.
  CANT_CANCEL: -31007,
  CANT_PERFORM_OPERATION: -31008,
  ACCOUNT_NOT_FOUND: -31050,
};

export interface PaymeRpcRequest {
  method: string;
  params: any;
  id: number | string;
}

@Injectable()
export class PaymePaymentProvider implements PaymentGatewayProvider {
  readonly providerName = 'PAYME' as const;
  private readonly logger = new Logger(PaymePaymentProvider.name);

  constructor(private readonly config: ConfigService) {}

  generateCheckoutUrl(params: {
    merchantId: string;
    transactionId: string;
    amount: number; // in UZS
  }): string {
    const amountTiyin = params.amount * 100;
    const raw = `m=${params.merchantId};ac.transaction_param=${params.transactionId};a=${amountTiyin}`;
    const encoded = Buffer.from(raw).toString('base64');
    return `https://checkout.paycom.uz/${encoded}`;
  }

  verifyBasicAuth(authHeader: string | undefined, paymeKey: string): boolean {
    if (!authHeader || !paymeKey) return false;
    const expected = 'Basic ' + Buffer.from(`Paycom:${paymeKey}`).toString('base64');
    // Constant time: the comparison does not tell how much of a guess was right.
    const a = Buffer.from(authHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async handleWebhook(payload: PaymeRpcRequest): Promise<any> {
    return payload;
  }
}
