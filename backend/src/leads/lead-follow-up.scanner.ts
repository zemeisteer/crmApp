import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeadsService } from './leads.service';

// Periodically emits LeadFollowUpDue for follow-ups whose time has passed.
// Interval: ADMISSIONS_FOLLOWUP_SCAN_MS (default 5 min, 0 disables). Off
// under tests so suites stay deterministic; they call scanDueFollowUps().
@Injectable()
export class LeadFollowUpScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Admissions');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly leads: LeadsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const ms = Number(this.config.get<string>('ADMISSIONS_FOLLOWUP_SCAN_MS') ?? 300_000);
    if (process.env.NODE_ENV === 'test' || !Number.isFinite(ms) || ms <= 0) return;
    this.timer = setInterval(() => {
      this.leads.scanDueFollowUps().catch((err: Error) => this.logger.warn(`Follow-up scan failed: ${err.message}`));
    }, ms);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
