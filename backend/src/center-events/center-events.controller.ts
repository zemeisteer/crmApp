import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { CalendarTouch } from '../lessons/calendar-touch.interceptor';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { CenterEventsService } from './center-events.service';
import { CreateCenterEventDto, ListCenterEventsDto, UpdateCenterEventDto } from './center-events.dto';

@Controller('center-events')
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
// A saved, moved or deleted event reaches the calendars (ICS and Google) at the next sync.
@UseInterceptors(CalendarTouch)
export class CenterEventsController {
  constructor(private readonly service: CenterEventsService) {}

  // Every staff member sees them, beside the timetable.
  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query() q: ListCenterEventsDto) {
    return this.service.list(tenantId, q);
  }

  @Roles('ADMIN', 'MANAGER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateCenterEventDto) {
    return this.service.create(user.tenantId!, user.sub, dto, { role: user.role, userId: user.sub, access: user.access });
  }

  @Roles('ADMIN', 'MANAGER')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateCenterEventDto) {
    return this.service.update(user.tenantId!, user.sub, id, dto, { role: user.role, userId: user.sub, access: user.access });
  }

  @Roles('ADMIN', 'MANAGER')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, userId, id);
  }
}
