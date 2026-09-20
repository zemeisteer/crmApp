import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<string>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');
    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: { user, pass },
      });
    }
  }

  get isConfigured() {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string) {
    if (!this.transporter) {
      // Dev fallback: nothing is actually sent without SMTP creds. We log
      // it so the flow (reset/verify tokens) stays testable end-to-end
      // without a real mail account.
      this.logger.warn(`SMTP not configured — email not sent. To: ${to}, Subject: ${subject}\n${text}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.config.get<string>('SMTP_FROM') || 'TalimCRM <no-reply@talimcrm.uz>',
        to,
        subject,
        text,
      });
    } catch (err) {
      this.logger.error(`Email send failed: ${(err as Error).message}`);
    }
  }
}
