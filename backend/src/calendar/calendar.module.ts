import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PortalAuthModule } from '../portal/portal-auth.module';
import { CalendarController } from './calendar.controller';
import { CalendarEventsService } from './calendar-events.service';
import { CalendarFeedsService } from './calendar-feeds.service';
import { CalendarSyncService } from './calendar-sync.service';
import { GOOGLE_CALENDAR_API, HttpGoogleCalendarApi } from './google-calendar.api';

@Module({
  imports: [PortalAuthModule],
  controllers: [CalendarController],
  providers: [
    CalendarEventsService,
    CalendarFeedsService,
    CalendarSyncService,
    {
      provide: GOOGLE_CALENDAR_API,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new HttpGoogleCalendarApi(
        { clientId: config.get('GOOGLE_CLIENT_ID'), clientSecret: config.get('GOOGLE_CLIENT_SECRET') },
        config.get('GOOGLE_OAUTH_BASE') || undefined,
        config.get('GOOGLE_AUTH_BASE') || undefined,
        config.get('GOOGLE_CALENDAR_API_BASE') || undefined,
      ),
    },
  ],
  exports: [CalendarEventsService, CalendarSyncService],
})
export class CalendarModule {}
