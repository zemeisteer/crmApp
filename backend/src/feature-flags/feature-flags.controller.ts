import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { FeatureFlagsService } from './feature-flags.service';
import { SetFeatureFlagDto } from './dto/feature-flag.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('feature-flags')
export class FeatureFlagsController {
  constructor(private readonly service: FeatureFlagsService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string | null) {
    return this.service.listForTenant(tenantId);
  }

  @Roles('SUPERADMIN')
  @Post('global')
  setGlobal(@Body() dto: SetFeatureFlagDto) {
    return this.service.setGlobal(dto.key, dto.enabled);
  }
}
