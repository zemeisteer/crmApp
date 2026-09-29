import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RemindersService } from './reminders.service';

// Runs the reminder pass every REMINDER_SCAN_MS (default 5 min in
// production, 0 disables). Off under tests; suites call the service directly.
@Injectable()
export class RemindersScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Reminders');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    // On in production; on a dev machine only when REMINDER_SCAN_MS is set,
    // so local test data never messages real Telegram accounts by surprise.
    const configured = this.config.get<string>('REMINDER_SCAN_MS');
    if (process.env.NODE_ENV === 'test') return;
    if (process.env.NODE_ENV !== 'production' && !configured) return;
    const ms = Number(configured ?? 300_000);
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      if (this.running) return; // a slow pass never overlaps the next one
      this.running = true;
      this.reminders
        .scan()
        .then((r) => (r.lessons || r.payments) && this.logger.log(`Sent ${r.lessons} lesson and ${r.payments} payment reminder(s)`))
        .catch((err: Error) => this.logger.warn(`Reminder scan failed: ${err.message}`))
        .finally(() => (this.running = false));
    }, ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
