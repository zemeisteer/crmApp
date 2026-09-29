import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { RemindersService } from './reminders.service';
import { RemindersScanner } from './reminders.scanner';

@Module({
  imports: [ConfigModule, NotificationsModule, PaymentsModule],
  providers: [RemindersService, RemindersScanner],
  exports: [RemindersService],
})
export class RemindersModule {}
