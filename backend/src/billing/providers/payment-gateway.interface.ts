export interface PaymentGatewayProvider {
  readonly providerName: 'CLICK' | 'PAYME';

  generateCheckoutUrl(params: {
    merchantId: string;
    serviceId?: string;
    transactionId: string;
    amount: number; // in UZS
  }): string;

  handleWebhook(payload: any, headers?: Record<string, string | string[] | undefined>): Promise<any>;
}
