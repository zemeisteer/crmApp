import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { RequiresFeature } from '../trial/trial.interceptor';
import { CustomDomainsService } from './custom-domains.service';
import { AddCustomDomainDto } from './dto/custom-domain.dto';

@Controller('custom-domains')
export class CustomDomainsController {
  constructor(private readonly service: CustomDomainsService) {}

  // The site's front door asks which center a host is (verified domains only).
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @Get('resolve/:host')
  async resolve(@Param('host') host: string) {
    const found = await this.service.resolve(host);
    if (!found) throw new NotFoundException('Domen ulanmagan');
    return found;
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @RequiresFeature('CUSTOM_DOMAIN')
  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.service.list(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @RequiresFeature('CUSTOM_DOMAIN')
  @Post()
  add(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: AddCustomDomainDto) {
    return this.service.add(tenantId, dto.domain, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @RequiresFeature('CUSTOM_DOMAIN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(':id/verify')
  verify(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.verify(tenantId, id, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id, userId);
  }
}
