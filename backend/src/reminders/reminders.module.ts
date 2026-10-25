import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { SignalsModule } from '../signals/signals.module';
import { RemindersService } from './reminders.service';
import { RemindersScanner } from './reminders.scanner';

@Module({
  imports: [ConfigModule, NotificationsModule, PaymentsModule, InvoicesModule, SignalsModule],
  providers: [RemindersService, RemindersScanner],
  exports: [RemindersService],
})
export class RemindersModule {}
