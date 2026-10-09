import { Body, Controller, Delete, Get, Header, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { PortalAuthGuard } from '../portal/portal-auth.guard';
import { PortalUser, PortalUserPayload } from '../portal/portal-user.decorator';
import { CalendarFeedsService } from './calendar-feeds.service';
import { CalendarSyncService } from './calendar-sync.service';
import { scopeForRole, type CalendarOwner } from './calendar-events.service';

export class ConnectGoogleDto {
  @IsOptional() @IsString() @MaxLength(100) returnTo?: string;
}
export class ChooseCalendarDto {
  @IsString() @MaxLength(300) calendarId!: string;
}

// Everyone with an account in the center has their own calendar: staff
// (by role: teacher -> what they teach, others -> the whole center) and
// parents (their children). Students use the cabinet routes below.
const ACCOUNT_ROLES = ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER', 'PARENT'] as const;

function ownerOf(user: JwtPayload): CalendarOwner {
  const scope = scopeForRole(user.role);
  if (!user.tenantId || !scope) throw new NotFoundException("Kalendar yo'q");
  return { tenantId: user.tenantId, scope, userId: user.sub };
}

@Controller()
export class CalendarController {
  constructor(
    private readonly feeds: CalendarFeedsService,
    private readonly sync: CalendarSyncService,
  ) {}

  // ---- the subscription itself (no login: the link is the key) ----

  @Get('calendar/feed/:token')
  async feed(@Param('token') token: string, @Res() res: Response) {
    const body = await this.feeds.render(token);
    if (body === null) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set({ 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="lessons.ics"' });
    res.send(body);
  }

  // ---- staff and parent accounts ----

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Get('calendar/feed')
  myFeed(@CurrentUser() user: JwtPayload) {
    return this.feeds.current(ownerOf(user)).then((feed) => ({ scope: ownerOf(user).scope, feed }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Post('calendar/feed')
  rotateFeed(@CurrentUser() user: JwtPayload) {
    return this.feeds.rotate(ownerOf(user), user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Delete('calendar/feed')
  revokeFeed(@CurrentUser() user: JwtPayload) {
    return this.feeds.revoke(ownerOf(user), user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Get('calendar/google')
  google(@CurrentUser() user: JwtPayload) {
    return this.sync.status(ownerOf(user).tenantId, user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Post('calendar/google/connect')
  connect(@CurrentUser() user: JwtPayload, @Body() dto: ConnectGoogleDto) {
    return this.sync.connectUrl(ownerOf(user).tenantId, user.sub, dto.returnTo);
  }

  // Google sends the browser here; who is connecting comes from the stored state only.
  @Get('calendar/google/callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    res.redirect(302, await this.sync.callback({ code, state, error }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Get('calendar/google/calendars')
  calendars(@CurrentUser() user: JwtPayload) {
    return this.sync.calendars(ownerOf(user).tenantId, user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Patch('calendar/google')
  choose(@CurrentUser() user: JwtPayload, @Body() dto: ChooseCalendarDto) {
    return this.sync.setCalendar(ownerOf(user).tenantId, user.sub, dto.calendarId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Post('calendar/google/sync')
  syncNow(@CurrentUser() user: JwtPayload) {
    return this.sync.requestSync(ownerOf(user).tenantId, user.sub);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...ACCOUNT_ROLES)
  @Delete('calendar/google')
  disconnect(@CurrentUser() user: JwtPayload) {
    return this.sync.disconnect(ownerOf(user).tenantId, user.sub);
  }

  // ---- the student's cabinet (student or parent viewing that student) ----

  @UseGuards(PortalAuthGuard)
  @Get('portal/calendar/feed')
  async cabinetFeed(@PortalUser() user: PortalUserPayload) {
    return { scope: 'STUDENT', feed: await this.feeds.current({ tenantId: user.tenantId, scope: 'STUDENT', studentId: user.studentId }) };
  }

  @UseGuards(PortalAuthGuard)
  @Post('portal/calendar/feed')
  cabinetRotate(@PortalUser() user: PortalUserPayload) {
    return this.feeds.rotate({ tenantId: user.tenantId, scope: 'STUDENT', studentId: user.studentId }, null);
  }

  @UseGuards(PortalAuthGuard)
  @Delete('portal/calendar/feed')
  cabinetRevoke(@PortalUser() user: PortalUserPayload) {
    return this.feeds.revoke({ tenantId: user.tenantId, scope: 'STUDENT', studentId: user.studentId }, null);
  }
}
