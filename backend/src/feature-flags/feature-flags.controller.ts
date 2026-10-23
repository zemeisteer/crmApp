import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { SetFeatureFlagDto, SetFlagStateDto } from './dto/feature-flag.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  // A center's view of the switches as they apply to it.
  @Get()
  list(@CurrentUser('tenantId') tenantId: string | null) {
    return this.service.listForTenant(tenantId);
  }

  @Roles('SUPERADMIN')
  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Roles('SUPERADMIN')
  @Post('global')
  setGlobal(@CurrentUser('sub') actorId: string, @Body() dto: SetFeatureFlagDto) {
    return this.service.setGlobal(dto.key, dto.enabled, actorId);
  }

  @Roles('SUPERADMIN')
  @Put(':key/tenants/:tenantId')
  setForTenant(@CurrentUser('sub') actorId: string, @Param('key') key: string, @Param('tenantId') tenantId: string, @Body() dto: SetFlagStateDto) {
    return this.service.setForTenant(key, tenantId, dto.enabled, actorId);
  }

  @Roles('SUPERADMIN')
  @Delete(':key/tenants/:tenantId')
  clearForTenant(@CurrentUser('sub') actorId: string, @Param('key') key: string, @Param('tenantId') tenantId: string) {
    return this.service.clearForTenant(key, tenantId, actorId);
  }
}
