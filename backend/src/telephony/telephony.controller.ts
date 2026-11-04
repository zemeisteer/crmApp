import { Body, Controller, Delete, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { SaveTelephonyAccountDto, SetTelephonyExtensionsDto } from './dto/telephony.dto';
import { TelephonyAccountsService } from './telephony-accounts.service';

// The center's telephony settings: owner and admins only (like the center's
// payment accounts). The secret never comes back.
@Controller('telephony')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class TelephonyController {
  constructor(private readonly accounts: TelephonyAccountsService) {}

  @Get('settings')
  settings(@CurrentUser('tenantId') tenantId: string) {
    return this.accounts.view(tenantId);
  }

  @Put('settings')
  save(@CurrentUser('tenantId') tenantId: string, @Body() dto: SaveTelephonyAccountDto) {
    return this.accounts.save(tenantId, dto);
  }

  @Delete('settings')
  remove(@CurrentUser('tenantId') tenantId: string) {
    return this.accounts.remove(tenantId);
  }

  @Post('settings/test')
  @HttpCode(200)
  test(@CurrentUser('tenantId') tenantId: string) {
    return this.accounts.test(tenantId);
  }

  @Post('settings/rotate-token')
  @HttpCode(200)
  rotate(@CurrentUser('tenantId') tenantId: string) {
    return this.accounts.rotateToken(tenantId);
  }

  @Put('extensions')
  setExtensions(@CurrentUser('tenantId') tenantId: string, @Body() dto: SetTelephonyExtensionsDto) {
    return this.accounts.setExtensions(tenantId, dto.items);
  }
}
