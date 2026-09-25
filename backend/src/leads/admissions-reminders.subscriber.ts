import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { leads, organizationMemberships, users } from '../db/schema';
import { EmailService } from '../email/email.service';
import { formatZoned } from '../common/timezone';
import { AdmissionsEventsService, type AdmissionsEvent } from './admissions-events.service';
import { LeadsService } from './leads.service';

// Emails the assigned manager when a follow-up falls due or a trial lesson
// is booked on their lead, and the center's leadership when an application
// arrives from the public website. It only subscribes to the admissions event
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
    const handleWebsiteLead = (e: AdmissionsEvent) => {
      if (e.data?.channel !== 'public_form') return;
      this.notifyNewWebsiteLead(e).catch((err: Error) => this.logger.warn(`New-lead notice for ${e.leadId} failed: ${err.message}`));
    };
    this.unsubscribers = [
      this.events.on('LeadFollowUpDue', handle),
      this.events.on('TrialBooked', handle),
      this.events.on('LeadCreated', handleWebsiteLead),
    ];
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
        : [
            `Sinov darsi belgilandi: ${lead.fullName}`,
            `"${lead.fullName}" uchun sinov darsi belgilandi: ${await this.formatForTenant(e.tenantId, e.data?.scheduledAt)}.`,
          ];
    await this.email.send(manager.email, subject, `Assalomu alaykum, ${manager.fullName}!\n\n${body}\n\nLidni ochish: ${link}`);
    return true;
  }

  // New application from the public site: nobody owns it yet, so everyone
  // who can assign it (active OWNER/ADMIN/MANAGER) hears about it.
  async notifyNewWebsiteLead(e: AdmissionsEvent) {
    const [lead] = await this.db
      .select({ id: leads.id, fullName: leads.fullName })
      .from(leads)
      .where(and(eq(leads.id, e.leadId), eq(leads.tenantId, e.tenantId)));
    if (!lead) return 0;
    const recipients = await this.db
      .select({ email: users.email, fullName: users.fullName })
      .from(organizationMemberships)
      .innerJoin(users, eq(users.id, organizationMemberships.userId))
      .where(
        and(
          eq(organizationMemberships.tenantId, e.tenantId),
          eq(organizationMemberships.status, 'ACTIVE'),
          inArray(organizationMemberships.role, ['OWNER', 'ADMIN', 'MANAGER']),
        ),
      );
    const link = `${this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000'}/leads/${lead.id}`;
    for (const r of recipients) {
      await this.email.send(
        r.email,
        `Saytdan yangi ariza: ${lead.fullName}`,
        `Assalomu alaykum, ${r.fullName}!

Markaz saytidan yangi ariza keldi: "${lead.fullName}". Lidni biriktiring va bog'laning.

Lidni ochish: ${link}`,
      );
    }
    return recipients.length;
  }

  // Trial time in the center's own timezone, e.g. "2026-10-01 10:00 (Asia/Tashkent)".
  private async formatForTenant(tenantId: string, iso: unknown) {
    if (typeof iso !== 'string') return '';
    const tz = await this.leadsService.tenantTimezone(tenantId);
    return `${formatZoned(new Date(iso), tz)} (${tz})`;
  }
}

