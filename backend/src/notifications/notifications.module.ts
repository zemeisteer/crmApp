import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { EskizProvider } from './sms/eskiz.provider';
import { PlayMobileProvider } from './sms/playmobile.provider';

@Module({
  imports: [DbModule, TelegramModule, ConfigModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    EskizProvider,
    PlayMobileProvider,
  ],
  exports: [NotificationsService, EskizProvider, PlayMobileProvider],
})
export class NotificationsModule {}
