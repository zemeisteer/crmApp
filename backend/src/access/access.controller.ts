import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { RouteAccessService } from './route-access';
import { buildMatrix } from './access-matrix';
import { ACCESS_AREAS, ACCESS_CATALOG, CONFIGURABLE_ROLES } from './catalog';

// Who can do what: the owner's and admins' view of the role rules.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('access')
export class AccessController {
  constructor(private readonly routes: RouteAccessService) {}

  @Get('matrix')
  matrix() {
    return buildMatrix((m, p) => this.routes.find(m, p));
  }

  // What can be turned on or off for a staff member, and each role's default.
  @Get('catalog')
  catalog() {
    return {
      roles: [...CONFIGURABLE_ROLES],
      areas: [...ACCESS_AREAS],
      keys: ACCESS_CATALOG.map((k) => ({ key: k.key, area: k.area, template: [...k.template] })),
    };
  }
}
