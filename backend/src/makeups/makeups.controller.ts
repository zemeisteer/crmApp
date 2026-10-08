import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { PortalAuthGuard } from '../portal/portal-auth.guard';
import { PortalUser, PortalUserPayload } from '../portal/portal-user.decorator';
import { MakeupsService } from './makeups.service';

export class IssueCreditDto {
  @IsString() studentId!: string;
  @IsString() groupId!: string;
  @IsString() date!: string;
  @IsIn(['ABSENT', 'LESSON_CANCELLED']) reason!: 'ABSENT' | 'LESSON_CANCELLED';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class BookMakeupDto {
  @IsIn(['GROUP_LESSON', 'SESSION']) mode!: 'GROUP_LESSON' | 'SESSION';
  @IsOptional() @IsString() targetGroupId?: string;
  @IsString() date!: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsString() teacherId?: string;
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class MarkMakeupDto {
  @IsIn(['ATTENDED', 'MISSED']) status!: 'ATTENDED' | 'MISSED';
}

@Controller()
export class MakeupsController {
  constructor(private readonly service: MakeupsService) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Get('makeups/eligible')
  eligible(@CurrentUser() user: JwtPayload, @Query('from') from: string, @Query('to') to: string) {
    return this.service.eligible(user.tenantId!, from, to, { role: user.role, userId: user.sub });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Get('makeups/credits')
  credits(@CurrentUser() user: JwtPayload, @Query('status') status?: string, @Query('studentId') studentId?: string) {
    return this.service.credits(user.tenantId!, { status, studentId }, { role: user.role, userId: user.sub });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('makeups/credits')
  issue(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: IssueCreditDto) {
    return this.service.issue(tenantId, userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('makeups/credits/:id/cancel')
  cancelCredit(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.cancelCredit(tenantId, userId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('makeups/credits/:id/reinstate')
  reinstate(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.reinstate(tenantId, userId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('makeups/credits/:id/book')
  book(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: BookMakeupDto) {
    return this.service.book(tenantId, userId, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('makeups/bookings/:id/cancel')
  cancelBooking(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.cancelBooking(tenantId, userId, id);
  }

  // Teachers too: the make-ups they teach (a session, or a seat in their group).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER')
  @Get('makeups/roster')
  roster(@CurrentUser() user: JwtPayload, @Query('from') from: string, @Query('to') to: string) {
    return this.service.roster(user.tenantId!, from, to, { role: user.role, userId: user.sub });
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER')
  @Post('makeups/bookings/:id/attendance')
  mark(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: MarkMakeupDto) {
    return this.service.mark(user.tenantId!, { role: user.role, userId: user.sub }, id, dto.status);
  }

  @UseGuards(PortalAuthGuard)
  @Get('portal/makeups')
  portal(@PortalUser() user: PortalUserPayload) {
    return this.service.forStudent(user.tenantId, user.studentId);
  }
}
