import { Module } from '@nestjs/common';
import { PlansModule } from '../plans/plans.module';
import { PlatformBillingModule } from '../platform-billing/platform-billing.module';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { PlatformSettingsService } from './platform-settings.service';

@Module({
  imports: [PlansModule, PlatformBillingModule],
  providers: [PlatformService, PlatformSettingsService],
  controllers: [PlatformController],
})
export class PlatformModule {}
