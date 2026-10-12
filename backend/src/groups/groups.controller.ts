import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards, UseInterceptors } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { GroupsService } from './groups.service';
import { ConfirmGroupPriceDto, CreateGroupDto, UpdateGroupDto } from './dto/group.dto';
import { CalendarTouch } from '../lessons/calendar-touch.interceptor';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('groups')
@UseInterceptors(CalendarTouch)
export class GroupsController {
  constructor(private readonly service: GroupsService) {}

  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Query('courseId') courseId?: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.findAll(tenantId, role, userId, { courseId, status, branchId });
  }

  @Roles('ADMIN')
  @Get('trash')
  trash(@CurrentUser('tenantId') tenantId: string) {
    return this.service.trash(tenantId);
  }

  @Roles('ADMIN')
  @Get('schedule-conflicts')
  scheduleConflicts(
    @CurrentUser() user: JwtPayload,
    @Query('teacherId') teacherId: string,
    @Query('days') days: string,
    @Query('startTime') startTime: string,
    @Query('excludeId') excludeId?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.service.findScheduleConflicts(user.tenantId!, teacherId, days ?? '', startTime ?? '', excludeId, endTime, { role: user.role, userId: user.sub, access: user.access });
  }

  // Who can be marked for a lesson of this group on a date (those in the group then).
  @Get(':id/roster')
  roster(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Query('date') date: string,
    @Query('scheduleId') scheduleId?: string,
  ) {
    return this.service.roster(tenantId, id, date, scheduleId, role, userId);
  }

  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id, role, userId);
  }

  @Roles('ADMIN')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateGroupDto) {
    return this.service.create(user.tenantId!, user.sub, dto, { role: user.role, userId: user.sub, access: user.access });
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.service.update(user.tenantId!, user.sub, id, dto, { role: user.role, userId: user.sub, access: user.access });
  }

  // Price history: who may see money figures may read it; confirming what
  // a past month cost is for those who run the center and its books.
  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT')
  @Get(':id/price-history')
  priceHistory(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.priceHistory(tenantId, id);
  }

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Post(':id/price-history')
  confirmPrice(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: ConfirmGroupPriceDto,
  ) {
    return this.service.confirmPrice(tenantId, userId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenantId, userId, id);
  }

  @Roles('ADMIN')
  @Post(':id/restore')
  restore(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.restore(user.tenantId!, user.sub, id, { role: user.role, userId: user.sub, access: user.access });
  }
}
