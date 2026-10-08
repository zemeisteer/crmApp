import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PortalAuthGuard } from '../portal/portal-auth.guard';
import { PortalUser, PortalUserPayload } from '../portal/portal-user.decorator';
import { CustomFieldsService } from './custom-fields.service';
import { CreateCustomFieldDto, ListCustomFieldsQuery, UpdateCustomFieldDto } from './dto/custom-field.dto';

// Definitions are the center's settings (owner and admins). Values are read
// and written through the student and lead routes themselves, under their
// own permissions.
@Controller()
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  // Any staff member: the forms need the definitions to render.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('custom-fields')
  list(@CurrentUser('tenantId') tenantId: string, @Query() q: ListCustomFieldsQuery) {
    return this.service.list(tenantId, q.entityType, q.includeArchived === '1' || q.includeArchived === 'true');
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('custom-fields')
  create(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CreateCustomFieldDto) {
    return this.service.create(tenantId, userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('custom-fields/:id')
  update(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: UpdateCustomFieldDto) {
    return this.service.update(tenantId, userId, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('custom-fields/:id/archive')
  archive(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.archive(tenantId, userId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('custom-fields/:id/restore')
  restore(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.restore(tenantId, userId, id);
  }

  // The cabinet sees only the fields the center marked for it.
  @UseGuards(PortalAuthGuard)
  @Get('portal/custom-fields')
  portal(@PortalUser() user: PortalUserPayload) {
    return this.service.portalFields(user.tenantId, user.studentId);
  }
}
