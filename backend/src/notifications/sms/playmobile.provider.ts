import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider, SendSmsResult } from './sms-provider.interface';

@Injectable()
export class PlayMobileProvider implements SmsProvider {
  readonly name = 'playmobile';
  private readonly logger = new Logger(PlayMobileProvider.name);

  constructor(private readonly config: ConfigService) {}

  async sendSms(
    phone: string,
    text: string,
    options?: { sender?: string; apiToken?: string },
  ): Promise<SendSmsResult> {
    const cleanPhone = phone.replace(/\D/g, '');
    const token = options?.apiToken || this.config.get<string>('PLAYMOBILE_API_TOKEN');
    const sender = options?.sender || this.config.get<string>('PLAYMOBILE_ORIGINATOR') || '4546';

    if (!token) {
      this.logger.log(`[PlayMobile Sandbox/Mock] SMS to +${cleanPhone} via originator '${sender}': "${text}"`);
      return {
        success: true,
        messageId: `playmobile-mock-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        raw: { status: 'mock_delivered', phone: cleanPhone, sender },
      };
    }

    try {
      const messageId = `pm-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const payload = {
        messages: [
          {
            recipient: cleanPhone,
            'message-id': messageId,
            sms: {
              originator: sender,
              content: {
                text,
              },
            },
          },
        ],
      };

      const res = await fetch('https://send.playmobile.uz/broker-api/send', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        this.logger.warn(`PlayMobile API failed with status ${res.status}: ${JSON.stringify(json)}`);
        return {
          success: false,
          error: json?.message || `PlayMobile API HTTP ${res.status}`,
          raw: json,
        };
      }

      return {
        success: true,
        messageId,
        raw: json,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send SMS via PlayMobile: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
