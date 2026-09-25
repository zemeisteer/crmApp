import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { JwtPayload } from '../common/jwt.strategy';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { getEffectivePermissions } from '../common/permissions';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Same audience as the Reports page; sections inside are trimmed further
  // by role (finance, profit) and permission (admissions analytics).
  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT')
  @Get('overview')
  overview(@CurrentUser() user: JwtPayload, @Query('month') month?: string) {
    if (!user?.tenantId) throw new ForbiddenException('Tashkilot tanlanmagan');
    return this.reports.overview(
      user.tenantId,
      { role: user.role, permissions: getEffectivePermissions(user.role, user.permissions) },
      month,
    );
  }
}
