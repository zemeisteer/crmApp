import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider, SendSmsResult } from './sms-provider.interface';

@Injectable()
export class EskizProvider implements SmsProvider {
  readonly name = 'eskiz';
  private readonly logger = new Logger(EskizProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendSms(
    phone: string,
    text: string,
    options?: { sender?: string; apiToken?: string },
  ): Promise<SendSmsResult> {
    const cleanPhone = phone.replace(/\D/g, '');
    const token = options?.apiToken || this.config.get<string>('ESKIZ_API_TOKEN');
    const sender = options?.sender || this.config.get<string>('ESKIZ_SENDER') || '4546';

    if (!token) {
      this.logger.log(`[Eskiz Sandbox/Mock] SMS to +${cleanPhone} via sender '${sender}': "${text}"`);
      return {
        success: true,
        messageId: `eskiz-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        raw: { status: 'mock_delivered', phone: cleanPhone, sender },
      };
    }

    try {
      const body = new URLSearchParams();
      body.append('mobile_phone', cleanPhone);
      body.append('message', text);
      body.append('from', sender);

      const res = await fetch('https://notify.eskiz.uz/api/message/sms/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        this.logger.warn(`Eskiz API failed with status ${res.status}: ${JSON.stringify(json)}`);
        return {
          success: false,
          error: json?.message || `Eskiz API HTTP ${res.status}`,
          raw: json,
        };
      }

      return {
        success: true,
        messageId: json?.id ? String(json.id) : `eskiz-${Date.now()}`,
        raw: json,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send SMS via Eskiz: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
