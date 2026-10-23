import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseEnumPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { BillingService } from './billing.service';
import { GeneratePaymentLinkDto, SavePaymentAccountDto } from './dto/billing.dto';
import { PaymentAccountsService } from './payment-accounts.service';

const PROVIDERS = new ParseEnumPipe({ CLICK: 'CLICK', PAYME: 'PAYME' } as const);

@Controller('billing')
export class BillingController {
  constructor(
    private readonly service: BillingService,
    private readonly accounts: PaymentAccountsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('config')
  getConfig(@CurrentUser('tenantId') tenantId: string) {
    return this.service.getConfig(tenantId);
  }

  // The center's own Click / Payme accounts (the secret never comes back).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('accounts')
  listAccounts(@CurrentUser('tenantId') tenantId: string) {
    return this.accounts.list(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Put('accounts/:provider')
  saveAccount(@CurrentUser('tenantId') tenantId: string, @Param('provider', PROVIDERS) provider: 'CLICK' | 'PAYME', @Body() dto: SavePaymentAccountDto) {
    return this.accounts.save(tenantId, provider, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('accounts/:provider')
  removeAccount(@CurrentUser('tenantId') tenantId: string, @Param('provider', PROVIDERS) provider: 'CLICK' | 'PAYME') {
    return this.accounts.remove(tenantId, provider);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'ACCOUNTANT', 'MANAGER', 'RECEPTIONIST')
  @Post('click/link')
  clickLink(@CurrentUser('tenantId') tenantId: string, @Body() dto: GeneratePaymentLinkDto) {
    return this.service.generateClickLink(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'ACCOUNTANT', 'MANAGER', 'RECEPTIONIST')
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

  // A center's own merchant account calls back here (the address shown in
  // its settings): checked with that center's key, its transactions only.
  @Post('click/webhook/:tenantId')
  @HttpCode(200)
  centerClickWebhook(@Param('tenantId') tenantId: string, @Body() body: Record<string, string>) {
    return this.service.handleClickWebhook(body, { tenantId });
  }

  @Post('payme/webhook/:tenantId')
  @HttpCode(200)
  centerPaymeWebhook(@Param('tenantId') tenantId: string, @Headers('authorization') auth: string | undefined, @Body() body: any) {
    return this.service.handlePaymeWebhook(auth, body, { tenantId });
  }
}
