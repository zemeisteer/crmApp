import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { RouteAccessService } from './route-access';
import { buildMatrix } from './access-matrix';

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
}
