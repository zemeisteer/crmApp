import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ScheduleService } from './schedule.service';
import { CreateRoomDto, UpdateRoomDto } from './dto/room.dto';
import { CheckConflictDto, CreateScheduleDto, UpdateScheduleDto } from './dto/schedule.dto';

@Controller('schedule')
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
export class ScheduleController {
  constructor(private readonly service: ScheduleService) {}

  // ==================== ROOMS ====================

  @Get('rooms')
  findAllRooms(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findAllRooms(tenantId);
  }

  @Get('rooms/:id')
  findOneRoom(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOneRoom(tenantId, id);
  }

  @Roles('ADMIN')
  @Post('rooms')
  createRoom(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateRoomDto) {
    return this.service.createRoom(tenantId, dto);
  }

  @Roles('ADMIN')
  @Patch('rooms/:id')
  updateRoom(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.service.updateRoom(tenantId, id, dto);
  }

  @Roles('ADMIN')
  @Delete('rooms/:id')
  deleteRoom(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.deleteRoom(tenantId, id);
  }

  // ==================== CONFLICT CHECK ====================

  @Post('check-conflict')
  checkConflicts(@CurrentUser('tenantId') tenantId: string, @Body() dto: CheckConflictDto) {
    return this.service.checkConflicts(tenantId, dto);
  }

  // ==================== SCHEDULES ====================

  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('branchId') branchId?: string,
    @Query('groupId') groupId?: string,
    @Query('teacherId') teacherId?: string,
    @Query('roomId') roomId?: string,
    @Query('dayOfWeek') dayOfWeek?: string,
  ) {
    return this.service.findAllSchedules(tenantId, {
      branchId,
      groupId,
      teacherId,
      roomId,
      dayOfWeek: dayOfWeek ? parseInt(dayOfWeek, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOneSchedule(tenantId, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateScheduleDto) {
    return this.service.createSchedule(tenantId, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.service.updateSchedule(tenantId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  delete(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.deleteSchedule(tenantId, id);
  }
}
