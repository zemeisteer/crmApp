import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvoicesModule } from '../invoices/invoices.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { AdmissionsEventsService } from './admissions-events.service';
import { AdmissionsRemindersSubscriber } from './admissions-reminders.subscriber';
import { TrialSmsSubscriber } from './trial-sms.subscriber';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeadConversionService } from './lead-conversion.service';
import { LeadFollowUpScanner } from './lead-follow-up.scanner';
import { LeadTrialsService } from './lead-trials.service';
import { LeadsController } from './leads.controller';
import { TrialsMineController } from './trials-mine.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [ConfigModule, ScheduleModule, InvoicesModule, NotificationsModule],
  controllers: [LeadsController, TrialsMineController],
  providers: [LeadsService, LeadTrialsService, LeadConversionService, AdmissionsEventsService, LeadFollowUpScanner, AdmissionsRemindersSubscriber, TrialSmsSubscriber],
  exports: [LeadsService, AdmissionsEventsService],
})
export class LeadsModule {}
