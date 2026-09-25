import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

const RESEND_URL = 'https://api.resend.com/emails';

// Outgoing email. Provider is chosen from the environment:
//  1. RESEND_API_KEY  -> Resend HTTP API (resend.com)
//  2. SMTP_HOST/PORT/USER/PASS -> any SMTP server (e.g. Gmail app password)
//  3. neither -> nothing is sent; the message is logged so dev flows
//     (password reset, verification) stay testable.
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private readonly resendKey: string | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    this.resendKey = this.config.get<string>('RESEND_API_KEY')?.trim() || null;
    this.from =
      this.config.get<string>('EMAIL_FROM')?.trim() ||
      this.config.get<string>('SMTP_FROM')?.trim() ||
      'CRMAPP <no-reply@crmapp.com>';

    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<string>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (!this.resendKey && host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
      });
    }
  }

  get isConfigured() {
    return this.resendKey !== null || this.transporter !== null;
  }

  get provider(): 'resend' | 'smtp' | 'none' {
    return this.resendKey ? 'resend' : this.transporter ? 'smtp' : 'none';
  }

  async send(to: string, subject: string, text: string) {
    if (this.resendKey) return this.sendViaResend(to, subject, text);
    if (!this.transporter) {
      // Dev fallback: nothing is actually sent without a provider. We log
      // it so the flow (reset/verify tokens) stays testable end-to-end
      // without a real mail account.
      this.logger.warn(`Email provider not configured — email not sent. To: ${to}, Subject: ${subject}\n${text}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text });
    } catch (err) {
      this.logger.error(`Email send failed: ${(err as Error).message}`);
    }
  }

  // Never throws: a mail outage must not break the request that sent it.
  private async sendViaResend(to: string, subject: string, text: string) {
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject, text }),
      });
      if (!res.ok) {
        // Resend's error body explains the cause (unverified domain, bad
        // "from", invalid key) and never echoes the key back.
        const detail = await res.text().catch(() => '');
        this.logger.error(`Resend rejected email (${res.status}): ${detail.slice(0, 300)}`);
      }
    } catch (err) {
      this.logger.error(`Resend request failed: ${(err as Error).message}`);
    }
  }
}
