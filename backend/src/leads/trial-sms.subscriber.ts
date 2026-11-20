import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { branches, groups, leads, leadTrials, tenants } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { formatZoned } from '../common/timezone';
import {
  AdmissionsEventsService,
  type AdmissionsEvent,
} from './admissions-events.service';

// The newcomer hears of their trial lesson by SMS: when it is booked and when
// it is moved. Sent only where the center can send SMS (its plan, its own or
// the platform's account, the monthly quota: notifications.service.ts); a
// center without SMS sends nothing and logs nothing. One SMS per trial: the
// trial id is the idempotency key, so a repeated event never sends twice.
@Injectable()
export class TrialSmsSubscriber implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TrialSms');
  private unsubscribers: (() => void)[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly events: AdmissionsEventsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    const handle = (e: AdmissionsEvent) => {
      this.notify(e).catch((err: Error) =>
        this.logger.warn(
          `Trial SMS for lead ${e.leadId} failed: ${err.message}`,
        ),
      );
    };
    this.unsubscribers = [
      this.events.on('TrialBooked', handle),
      this.events.on('TrialRescheduled', handle),
    ];
  }

  onModuleDestroy() {
    for (const off of this.unsubscribers) off();
  }

  /** Returns whether an SMS was handed to the provider. */
  async notify(e: AdmissionsEvent): Promise<boolean> {
    const trialId = typeof e.data?.trialId === 'string' ? e.data.trialId : null;
    if (!trialId) return false;
    const route = await this.notifications.smsRoute(e.tenantId);
    if (!route.ok) return false;
    const [row] = await this.db
      .select({
        status: leadTrials.status,
        scheduledAt: leadTrials.scheduledAt,
        leadName: leads.fullName,
        phone: leads.phone,
        group: groups.name,
        address: branches.address,
        center: tenants.name,
        centerPhone: tenants.phone,
        tz: tenants.timezone,
      })
      .from(leadTrials)
      .innerJoin(leads, eq(leads.id, leadTrials.leadId))
      .innerJoin(tenants, eq(tenants.id, leadTrials.tenantId))
      .leftJoin(groups, eq(groups.id, leadTrials.groupId))
      .leftJoin(branches, eq(branches.id, leadTrials.branchId))
      .where(
        and(eq(leadTrials.id, trialId), eq(leadTrials.tenantId, e.tenantId)),
      );
    if (!row || row.status !== 'BOOKED' || !row.phone?.trim()) return false;
    const sent = await this.notifications.send(e.tenantId, {
      channel: 'SMS',
      recipient: row.phone.trim(),
      event: 'LESSON_REMINDER',
      title: 'Sinov darsi',
      content: trialSmsText({ ...row, moved: e.name === 'TrialRescheduled' }),
      idempotencyKey: `trial-sms:${trialId}`,
    });
    return sent.status === 'SENT';
  }
}

/** The SMS text: short, no links (SMS providers refuse unregistered ones). */
export function trialSmsText(r: {
  center: string;
  scheduledAt: Date;
  tz: string | null;
  group: string | null;
  address: string | null;
  centerPhone: string | null;
  moved?: boolean;
}) {
  const when = formatZoned(r.scheduledAt, r.tz || 'Asia/Tashkent').slice(0, 16);
  return [
    `${r.center}: sinov darsingiz ${r.moved ? "ko'chirildi" : 'belgilandi'} - ${when}`,
    r.group ? `Guruh: ${r.group}` : null,
    r.address ? `Manzil: ${r.address}` : null,
    r.centerPhone ? `Tel: ${r.centerPhone}` : null,
  ]
    .filter(Boolean)
    .join('. ');
}
