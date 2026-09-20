import { Body, Controller, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { BillingService } from './billing.service';
import { GeneratePaymentLinkDto } from './dto/billing.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('click/link')
  clickLink(@CurrentUser('tenantId') tenantId: string, @Body() dto: GeneratePaymentLinkDto) {
    return this.service.generateClickLink(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('payme/link')
  paymeLink(@CurrentUser('tenantId') tenantId: string, @Body() dto: GeneratePaymentLinkDto) {
    return this.service.generatePaymeLink(tenantId, dto);
  }

  // Called directly by Click's servers — no JWT available.
  @Post('click/webhook')
  @HttpCode(200)
  clickWebhook(@Body() body: Record<string, string>) {
    return this.service.handleClickWebhook(body);
  }

  // Called directly by Payme's servers — authenticated via Basic auth, not JWT.
  @Post('payme/webhook')
  @HttpCode(200)
  paymeWebhook(@Headers('authorization') auth: string | undefined, @Body() body: any) {
    return this.service.handlePaymeWebhook(auth, body);
  }
}
