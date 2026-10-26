import { Module } from '@nestjs/common';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingController } from './platform-billing.controller';
import { PlansModule } from '../plans/plans.module';
import { BillingLifecycleService } from './billing-lifecycle.service';
import { PlatformCardService } from './platform-card.service';
import { PlatformCardAdminController, PlatformCardController } from './platform-card.controller';

@Module({
  imports: [PlansModule],
  providers: [PlatformBillingService, BillingLifecycleService, PlatformCardService],
  controllers: [PlatformBillingController, PlatformCardController, PlatformCardAdminController],
  exports: [BillingLifecycleService],
})
export class PlatformBillingModule {}
