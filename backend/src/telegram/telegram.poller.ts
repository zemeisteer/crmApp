import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

// Local/dev alternative to the webhook: Telegram can only push webhooks to
// a public HTTPS URL, so on a developer machine the bot would never hear
// "/start". With TELEGRAM_POLLING=true the server pulls updates itself
// (getUpdates long polling). Enabling it removes any registered webhook,
// because Telegram refuses getUpdates while one is set — so leave it off in
// production, which uses the webhook.
@Injectable()
export class TelegramPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPoller.name);
  private running = false;
  private offset = 0;

  constructor(
    private readonly telegram: TelegramService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    if (this.config.get<string>('TELEGRAM_POLLING') !== 'true' || !token || process.env.NODE_ENV === 'test') return;
    this.running = true;
    void this.loop(token);
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async loop(token: string) {
    const api = `https://api.telegram.org/bot${token}`;
    await fetch(`${api}/deleteWebhook`).catch(() => undefined);
    this.logger.log('Telegram polling started');
    while (this.running) {
      try {
        const res = await fetch(`${api}/getUpdates?timeout=25&offset=${this.offset}`);
        const body = (await res.json()) as { ok: boolean; result?: { update_id: number }[]; description?: string };
        if (!body.ok) {
          this.logger.warn(`getUpdates failed: ${body.description ?? res.status}`);
          await new Promise((r) => setTimeout(r, 5_000));
          continue;
        }
        for (const update of body.result ?? []) {
          this.offset = update.update_id + 1;
          await this.telegram.handleUpdate(update).catch((err: Error) => this.logger.warn(`Update failed: ${err.message}`));
        }
      } catch (err) {
        // Network hiccup: back off briefly. The token is never logged.
        this.logger.warn(`Telegram polling error: ${(err as Error).message}`);
        await new Promise((r) => setTimeout(r, 5_000));
      }
    }
  }
}
