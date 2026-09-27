import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { TeacherAttendanceService } from './teacher-attendance.service';

class TeacherMarkEntryDto {
  @IsString()
  groupId!: string;

  @IsIn(['PRESENT', 'LATE', 'ABSENT'])
  status!: 'PRESENT' | 'LATE' | 'ABSENT';

  @IsOptional()
  @IsString()
  substituteTeacherId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string | null;
}

class MarkTeacherAttendanceDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TeacherMarkEntryDto)
  entries!: TeacherMarkEntryDto[];
}

// Marked by the office (admins, managers, reception) for each lesson.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('teacher-attendance')
export class TeacherAttendanceController {
  constructor(private readonly service: TeacherAttendanceService) {}

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'RECEPTIONIST')
  @Get()
  day(@CurrentUser('tenantId') tenantId: string, @Query('date') date: string) {
    return this.service.day(tenantId, date);
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'RECEPTIONIST')
  @Post()
  mark(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: MarkTeacherAttendanceDto) {
    return this.service.mark(tenantId, userId, dto.date, dto.entries);
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT')
  @Get('month')
  async month(@CurrentUser('tenantId') tenantId: string, @Query('month') month: string) {
    const m = /^\d{4}-\d{2}$/.test(month ?? '') ? month : new Date().toISOString().slice(0, 7);
    const stats = await this.service.monthStats(tenantId, m);
    return { month: m, teachers: Object.fromEntries(stats) };
  }
}
