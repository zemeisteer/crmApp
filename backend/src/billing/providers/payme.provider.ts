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
    return authHeader === expected;
  }

  async handleWebhook(payload: PaymeRpcRequest): Promise<any> {
    return payload;
  }
}
