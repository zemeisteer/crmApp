export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  raw?: any;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(
    phone: string,
    text: string,
    options?: { sender?: string; apiToken?: string },
  ): Promise<SendSmsResult>;
}
