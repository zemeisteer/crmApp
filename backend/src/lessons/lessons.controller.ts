import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { LessonsService } from './lessons.service';

export class CancelLessonDto {
  @IsString() groupId!: string;
  @IsString() date!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('lessons')
export class LessonsController {
  constructor(private readonly service: LessonsService) {}

  // Dated lessons: every staff member (like the timetable).
  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query('from') from: string, @Query('to') to: string, @Query('groupId') groupId?: string) {
    return this.service.list(tenantId, from, to, groupId);
  }

  @Get('cancellations')
  cancellations(@CurrentUser('tenantId') tenantId: string, @Query('from') from: string, @Query('to') to: string) {
    return this.service.cancellations(tenantId, from, to);
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('cancellations')
  cancel(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CancelLessonDto) {
    return this.service.cancel(tenantId, userId, dto);
  }

  @Roles('ADMIN', 'MANAGER')
  @Delete('cancellations/:id')
  restore(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.restore(tenantId, userId, id);
  }
}
