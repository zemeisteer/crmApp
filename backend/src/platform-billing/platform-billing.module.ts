import { Module } from '@nestjs/common';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingController } from './platform-billing.controller';
import { PlansModule } from '../plans/plans.module';
import { BillingLifecycleService } from './billing-lifecycle.service';

@Module({
  imports: [PlansModule],
  providers: [PlatformBillingService, BillingLifecycleService],
  controllers: [PlatformBillingController],
  exports: [BillingLifecycleService],
})
export class PlatformBillingModule {}
