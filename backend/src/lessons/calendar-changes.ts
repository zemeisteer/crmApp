import { Injectable, Logger } from '@nestjs/common';

/**
 * "The center's lessons changed" - lessons cancelled or restored, make-ups
 * booked or cancelled, timetables edited. External calendar sync listens
 * (calendar/calendar-sync.service.ts) and records the change durably; the
 * writer only awaits that record, never the sync itself.
 */
@Injectable()
export class CalendarChanges {
  private readonly logger = new Logger(CalendarChanges.name);
  private readonly listeners: Array<(tenantId: string) => Promise<unknown> | unknown> = [];

  onChange(listener: (tenantId: string) => Promise<unknown> | unknown) {
    this.listeners.push(listener);
  }

  async touch(tenantId: string | null | undefined) {
    if (!tenantId) return;
    for (const l of this.listeners) {
      try {
        await l(tenantId);
      } catch (err) {
        this.logger.warn(`calendar change not recorded: ${(err as Error).message}`);
      }
    }
  }
}
