import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PlatformService } from './platform.service';
import { PlatformSettingsService } from './platform-settings.service';
import { ListSubscriptionsDto, RecordPaymentDto, SaveIntegrationDto, UpdateSubscriptionDto } from './dto/platform.dto';

// The platform admin's own pages: every route is SUPERADMIN only.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly service: PlatformService,
    private readonly settings: PlatformSettingsService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  @Get('subscriptions')
  subscriptions(@Query() query: ListSubscriptionsDto) {
    return this.service.subscriptions(query);
  }

  @Patch('subscriptions/:tenantId')
  updateSubscription(@CurrentUser('sub') userId: string, @Param('tenantId') tenantId: string, @Body() dto: UpdateSubscriptionDto) {
    return this.service.updateSubscription(userId, tenantId, dto);
  }

  @Get('subscriptions/:tenantId/payments')
  payments(@Param('tenantId') tenantId: string) {
    return this.service.payments(tenantId);
  }

  @Post('subscriptions/:tenantId/payments')
  recordPayment(@CurrentUser('sub') userId: string, @Param('tenantId') tenantId: string, @Body() dto: RecordPaymentDto) {
    return this.service.recordPayment(userId, tenantId, dto);
  }

  @Get('integrations')
  integrations() {
    return this.settings.list();
  }

  // The password is checked on every save: a few tries a minute, so an open
  // session cannot be used to guess it.
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @Put('integrations/:id')
  saveIntegration(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: SaveIntegrationDto) {
    return this.settings.save(userId, id, dto.password, dto.values);
  }
}
