import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { CenterEventsService } from './center-events.service';
import { CreateCenterEventDto, ListCenterEventsDto, UpdateCenterEventDto } from './center-events.dto';

@Controller('center-events')
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
export class CenterEventsController {
  constructor(private readonly service: CenterEventsService) {}

  // Every staff member sees them, beside the timetable.
  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query() q: ListCenterEventsDto) {
    return this.service.list(tenantId, q);
  }

  @Roles('ADMIN', 'MANAGER')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CreateCenterEventDto) {
    return this.service.create(tenantId, userId, dto);
  }

  @Roles('ADMIN', 'MANAGER')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCenterEventDto,
  ) {
    return this.service.update(tenantId, userId, id, dto);
  }

  @Roles('ADMIN', 'MANAGER')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, userId, id);
  }
}
