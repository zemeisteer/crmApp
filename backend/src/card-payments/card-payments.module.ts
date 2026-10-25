import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FilesModule } from '../files/files.module';
import { PaymentsModule } from '../payments/payments.module';
import { TelegramModule } from '../telegram/telegram.module';
import { CardPaymentsController } from './card-payments.controller';
import { CardPaymentsService } from './card-payments.service';

@Module({
  imports: [AuditModule, FilesModule, PaymentsModule, TelegramModule],
  providers: [CardPaymentsService],
  controllers: [CardPaymentsController],
  exports: [CardPaymentsService],
})
export class CardPaymentsModule {}
