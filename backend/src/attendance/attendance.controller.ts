import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AttendanceService } from './attendance.service';
import { MarkAttendanceDto, QrCheckInDto, QueryAttendanceDto } from './dto/attendance.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly service: AttendanceService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query() query: QueryAttendanceDto) {
    return this.service.findAll(tenantId, query);
  }

  @Roles('ADMIN', 'TEACHER', 'MANAGER', 'RECEPTIONIST')
  @Post()
  mark(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: MarkAttendanceDto,
  ) {
    return this.service.mark(tenantId, dto, role, userId);
  }

  @Roles('ADMIN', 'TEACHER', 'MANAGER', 'RECEPTIONIST')
  @Post('qr-checkin')
  qrCheckIn(@CurrentUser('tenantId') tenantId: string, @Body() dto: QrCheckInDto) {
    return this.service.qrCheckIn(tenantId, dto);
  }
}

