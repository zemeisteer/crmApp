import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PlatformBillingService } from './platform-billing.service';
import { GeneratePlatformLinkDto } from './dto/platform-billing.dto';

@Controller('platform-billing')
export class PlatformBillingController {
  constructor(private readonly service: PlatformBillingService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('click/link')
  clickLink(@CurrentUser('tenantId') tenantId: string, @Body() dto: GeneratePlatformLinkDto) {
    return this.service.generateClickLink(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('payme/link')
  paymeLink(@CurrentUser('tenantId') tenantId: string, @Body() dto: GeneratePlatformLinkDto) {
    return this.service.generatePaymeLink(tenantId, dto);
  }

  @Post('click/webhook')
  @HttpCode(200)
  clickWebhook(@Body() body: Record<string, string>) {
    return this.service.handleClickWebhook(body);
  }

  @Post('payme/webhook')
  @HttpCode(200)
  paymeWebhook(@Headers('authorization') auth: string | undefined, @Body() body: any) {
    return this.service.handlePaymeWebhook(auth, body);
  }
}
