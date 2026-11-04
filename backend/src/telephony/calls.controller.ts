import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { JwtPayload } from '../common/jwt.strategy';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CallsHub } from './calls-hub.service';
import { CallsService, type CallsViewer } from './calls.service';

export class ListCallsQuery {
  @IsOptional() @IsString() @MaxLength(64) leadId?: string;
  @IsOptional() @IsString() @MaxLength(64) studentId?: string;
  @IsOptional() @IsString() @MaxLength(64) managerUserId?: string;
  @IsOptional() @IsIn(['ANSWERED', 'MISSED', 'RINGING']) status?: string;
  @IsOptional() @IsIn(['INBOUND', 'OUTBOUND']) direction?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @IsOptional() @IsISO8601() before?: string;
}

export class CallStatsQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['day', 'week']) period?: string;
}

export class ClickToCallDto {
  @IsString() @IsNotEmpty() @MaxLength(32) phone: string;
}

const viewer = (u: JwtPayload): CallsViewer => ({ tenantId: u.tenantId!, userId: u.sub, role: u.role });

// The call log, the live popup, click-to-call and the statistics. Who may
// open what is in access/catalog.ts (calls.view, calls.make, calls.stats);
// what they then see inside the center is CallsService's visibility rule.
@Controller('calls')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CallsController {
  constructor(
    private readonly service: CallsService,
    private readonly hub: CallsHub,
  ) {}

  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Get()
  list(@CurrentUser() u: JwtPayload, @Query() q: ListCallsQuery) {
    return this.service.list(viewer(u), q);
  }

  @Roles('ADMIN')
  @Get('stats')
  stats(@CurrentUser() u: JwtPayload, @Query() q: CallStatsQuery) {
    return this.service.stats(viewer(u), q);
  }

  // The incoming-call popup's event stream (calls-hub.service.ts).
  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @SkipThrottle()
  @Get('stream')
  stream(@CurrentUser() u: JwtPayload, @Req() req: Request, @Res() res: Response) {
    this.hub.subscribe({ tenantId: u.tenantId!, userId: u.sub, sid: u.sid }, req, res);
  }

  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Get(':id/card')
  card(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.card(viewer(u), id);
  }

  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Get(':id/recording')
  recording(@CurrentUser() u: JwtPayload, @Param('id') id: string) {
    return this.service.recording(viewer(u), id);
  }

  @Roles('ADMIN', 'MANAGER', 'RECEPTIONIST')
  @Post('click-to-call')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  clickToCall(@CurrentUser() u: JwtPayload, @Body() dto: ClickToCallDto) {
    return this.service.clickToCall(viewer(u), dto.phone);
  }
}
