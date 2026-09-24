import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { leads, users } from '../db/schema';
import { EmailService } from '../email/email.service';
import { AdmissionsEventsService, type AdmissionsEvent } from './admissions-events.service';
import { LeadsService } from './leads.service';

const TENANT_UTC_OFFSET_MIN = 5 * 60;

// Emails the assigned manager when a follow-up falls due or a trial lesson
// is booked on their lead. It only subscribes to the admissions event
// boundary, so the lead services never call a delivery channel directly.
// Staff have no Telegram link today, so email is the channel.
// ADMISSIONS_EMAIL_REMINDERS=false turns it off.
@Injectable()
export class AdmissionsRemindersSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Admissions');
  private unsubscribers: (() => void)[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: AdmissionsEventsService,
    private readonly email: EmailService,
    private readonly leadsService: LeadsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (this.config.get<string>('ADMISSIONS_EMAIL_REMINDERS') === 'false') return;
    const handle = (e: AdmissionsEvent) => {
      this.remind(e).catch((err: Error) => this.logger.warn(`Reminder for lead ${e.leadId} failed: ${err.message}`));
    };
    this.unsubscribers = [this.events.on('LeadFollowUpDue', handle), this.events.on('TrialBooked', handle)];
  }

  onModuleDestroy() {
    for (const off of this.unsubscribers) off();
  }

  async remind(e: AdmissionsEvent) {
    const [lead] = await this.db
      .select({ id: leads.id, fullName: leads.fullName, managerUserId: leads.assignedManagerUserId })
      .from(leads)
      .where(and(eq(leads.id, e.leadId), eq(leads.tenantId, e.tenantId)));
    if (!lead?.managerUserId) return false;
    // Someone who has since left the center gets nothing.
    if (!(await this.leadsService.activeAssignableMembership(this.db, e.tenantId, lead.managerUserId))) return false;
    const [manager] = await this.db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, lead.managerUserId));
    if (!manager?.email) return false;

    const link = `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/leads/${lead.id}`;
    // Deliberately no phone number or email of the prospect in the message.
    const [subject, body] =
      e.name === 'LeadFollowUpDue'
        ? [`Qayta aloqa vaqti: ${lead.fullName}`, `"${lead.fullName}" bilan qayta bog'lanish vaqti keldi.`]
        : [`Sinov darsi belgilandi: ${lead.fullName}`, `"${lead.fullName}" uchun sinov darsi belgilandi: ${formatTashkent(e.data?.scheduledAt)}.`];
    await this.email.send(manager.email, subject, `Assalomu alaykum, ${manager.fullName}!\n\n${body}\n\nLidni ochish: ${link}`);
    return true;
  }
}

function formatTashkent(iso: unknown) {
  if (typeof iso !== 'string') return '';
  const local = new Date(new Date(iso).getTime() + TENANT_UTC_OFFSET_MIN * 60_000);
  return `${local.toISOString().slice(0, 16).replace('T', ' ')} (Toshkent)`;
}
