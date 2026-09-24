import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { WebhooksService } from '../webhooks/webhooks.service';

export type AdmissionsEventName =
  | 'LeadCreated'
  | 'LeadAssigned'
  | 'LeadFollowUpDue'
  | 'TrialBooked'
  | 'TrialRescheduled'
  | 'TrialAttended'
  | 'LeadQualified'
  | 'LeadConverted'
  | 'LeadLost';

// Payloads carry identifiers only — never phone numbers or emails — so the
// event stream, logs and webhook bodies do not spread contact details.
export interface AdmissionsEvent {
  name: AdmissionsEventName;
  tenantId: string;
  leadId: string;
  actorUserId: string | null;
  data?: Record<string, string | number | boolean | null | undefined>;
  occurredAt: string;
}

const WEBHOOK_NAMES: Record<AdmissionsEventName, string> = {
  LeadCreated: 'lead.created',
  LeadAssigned: 'lead.assigned',
  LeadFollowUpDue: 'lead.follow_up_due',
  TrialBooked: 'lead.trial_booked',
  TrialRescheduled: 'lead.trial_rescheduled',
  TrialAttended: 'lead.trial_attended',
  LeadQualified: 'lead.qualified',
  LeadConverted: 'lead.converted',
  LeadLost: 'lead.lost',
};

// The admissions event boundary. Domain code only calls emit(); delivery
// channels (tenant webhooks today, Telegram/email reminders later) subscribe
// here instead of being called directly from the lead services. Emit only
// after the surrounding transaction has committed.
@Injectable()
export class AdmissionsEventsService {
  private readonly logger = new Logger('Admissions');
  private readonly bus = new EventEmitter();

  constructor(private readonly webhooks: WebhooksService) {
    this.bus.setMaxListeners(50);
  }

  emit(name: AdmissionsEventName, e: Omit<AdmissionsEvent, 'name' | 'occurredAt'>) {
    const event: AdmissionsEvent = { name, occurredAt: new Date().toISOString(), ...e };
    this.logger.log(
      JSON.stringify({ event: name, tenantId: e.tenantId, leadId: e.leadId, actorUserId: e.actorUserId, ...e.data }),
    );
    try {
      this.bus.emit(name, event);
      this.bus.emit('*', event);
    } catch (err) {
      // A faulty in-process subscriber must never break the domain action.
      this.logger.warn(`Admissions subscriber failed for ${name}: ${(err as Error).message}`);
    }
    void this.webhooks
      .dispatch(e.tenantId, WEBHOOK_NAMES[name], { leadId: e.leadId, ...e.data })
      .catch(() => undefined);
  }

  on(name: AdmissionsEventName | '*', listener: (event: AdmissionsEvent) => void) {
    this.bus.on(name, listener);
    return () => this.bus.off(name, listener);
  }
}
