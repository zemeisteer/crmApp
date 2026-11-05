import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LeadsModule } from '../leads/leads.module';
import { CallIngestService } from './call-ingest.service';
import { CallsHub } from './calls-hub.service';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { TelephonyProviders } from './providers/telephony-providers';
import { TelephonyAccountsService } from './telephony-accounts.service';
import { TelephonyWebhookController } from './telephony-webhook.controller';
import { TelephonyController } from './telephony.controller';

// IP telephony: a center's own provider account (Zadarma first), call
// webhooks, the call log. Provider specifics live in providers/.
@Module({
  imports: [ConfigModule, LeadsModule],
  controllers: [TelephonyController, TelephonyWebhookController, CallsController],
  providers: [TelephonyProviders, TelephonyAccountsService, CallIngestService, CallsHub, CallsService],
  exports: [TelephonyAccountsService, TelephonyProviders, CallIngestService, CallsHub],
})
export class TelephonyModule {}
