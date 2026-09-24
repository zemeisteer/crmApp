import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '../db/db.module';
import { TelegramModule } from '../telegram/telegram.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { ClickPaymentProvider } from './providers/click.provider';
import { PaymePaymentProvider } from './providers/payme.provider';

@Module({
  imports: [DbModule, ConfigModule, TelegramModule, NotificationsModule, AuditModule],
  providers: [BillingService, ClickPaymentProvider, PaymePaymentProvider],
  controllers: [BillingController],
  exports: [BillingService, ClickPaymentProvider, PaymePaymentProvider],
})
export class BillingModule {}

