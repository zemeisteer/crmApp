export interface SendSmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  // Not a clear "no": the request timed out or the provider failed on its
  // side, so the message may have gone. Never sent again automatically.
  uncertain?: boolean;
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
