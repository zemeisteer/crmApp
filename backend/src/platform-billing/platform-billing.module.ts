import { Module } from '@nestjs/common';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingController } from './platform-billing.controller';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [PlansModule],
  providers: [PlatformBillingService],
  controllers: [PlatformBillingController],
})
export class PlatformBillingModule {}
