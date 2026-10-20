import { Body, Controller, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PlatformService } from './platform.service';
import { PlatformSettingsService } from './platform-settings.service';
import { ListSubscriptionsDto, RecordPaymentDto, ReleaseTrialClaimDto, SaveIntegrationDto, UpdateSubscriptionDto } from './dto/platform.dto';
import { TrialClaimsService } from '../trial/trial-claims.service';
import { TrialLifecycleService } from '../trial/trial-lifecycle.service';
import { trialRules } from '../trial/trial-rules';

// The platform admin's own pages: every route is SUPERADMIN only.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('platform')
export class PlatformController {
  constructor(
    private readonly service: PlatformService,
    private readonly settings: PlatformSettingsService,
    private readonly trialClaims: TrialClaimsService,
    private readonly trialLifecycle: TrialLifecycleService,
  ) {}

  // What the trial deletion pass would do now, center by center, and why.
  // Writes and sends nothing (works with TRIAL_PURGE off too).
  @Get('trial-purge/preview')
  async trialPurgePreview() {
    const { report } = await this.trialLifecycle.run(new Date(), undefined, { dryRun: true });
    return { purgeEnabled: trialRules().purge, report };
  }

  // An exception to "one phone, one free trial": audited, with a reason.
  @Post('trial-claims/release')
  releaseTrialClaim(@CurrentUser('sub') userId: string, @Body() dto: ReleaseTrialClaimDto) {
    return this.trialClaims.release(dto.phone, dto.reason, userId);
  }

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

  // The password is checked on every save: a dozen a minute is enough to set
  // every integration up in one go, and far too few to guess a password with
  // an open session.
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Put('integrations/:id')
  saveIntegration(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: SaveIntegrationDto) {
    return this.settings.save(userId, id, dto.password, dto.values);
  }
}
