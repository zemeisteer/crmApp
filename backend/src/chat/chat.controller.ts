import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { PortalAuthGuard } from '../portal/portal-auth.guard';
import { PortalUser, PortalUserPayload } from '../portal/portal-user.decorator';
import type { ChatActor } from './chat-access';
import { ChatHub } from './chat-hub.service';
import { ChatService } from './chat.service';

export class OpenConversationDto {
  @IsIn(['STUDENT_CENTER', 'STUDENT_TEACHER', 'GROUP']) kind!: 'STUDENT_CENTER' | 'STUDENT_TEACHER' | 'GROUP';
  @IsOptional() @IsString() studentId?: string;
  @IsOptional() @IsString() teacherUserId?: string;
  @IsOptional() @IsString() groupId?: string;
}

export class SendMessageDto {
  // Checked again in the service (trimmed length, 2000).
  @IsString() @MaxLength(4000) body!: string;
  @IsString() @MaxLength(64) clientMessageId!: string;
}

export class ReadDto {
  @IsInt() @Min(0) seq!: number;
}

const STAFF = ['ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER'] as const;
const staff = (u: JwtPayload): ChatActor => ({ kind: 'staff', tenantId: u.tenantId!, userId: u.sub, role: u.role, access: u.access });
const cabinet = (u: PortalUserPayload): ChatActor => ({ kind: 'cabinet', tenantId: u.tenantId, studentId: u.studentId, viewer: u.viewer, parentUserId: u.parentUserId ?? null });

// Staff side (/chat) and the student's cabinet (/portal/chat): the same
// service, the actor taken from the session.
@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly hub: ChatHub,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Get('chat/conversations')
  list(@CurrentUser() u: JwtPayload) {
    return this.chat.list(staff(u));
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Post('chat/conversations')
  open(@CurrentUser() u: JwtPayload, @Body() dto: OpenConversationDto) {
    return this.chat.open(staff(u), dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Get('chat/conversations/:id/messages')
  messages(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Query('before') before?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.chat.messages(staff(u), id, { before, after, limit });
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('chat/conversations/:id/messages')
  send(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(staff(u), id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Post('chat/conversations/:id/read')
  read(@CurrentUser() u: JwtPayload, @Param('id') id: string, @Body() dto: ReadDto) {
    return this.chat.markRead(staff(u), id, dto.seq);
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Get('chat/unread')
  unread(@CurrentUser() u: JwtPayload) {
    return this.chat.unreadTotal(staff(u));
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @Get('chat/contacts')
  contacts(@CurrentUser() u: JwtPayload, @Query('q') q?: string) {
    return this.chat.contacts(staff(u), q);
  }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(...STAFF)
  @SkipThrottle()
  @Get('chat/stream')
  stream(@CurrentUser() u: JwtPayload, @Req() req: Request, @Res() res: Response) {
    this.hub.subscribe(staff(u), { sid: u.sid }, req, res);
  }

  // ---- the student's cabinet ----

  @UseGuards(PortalAuthGuard)
  @Get('portal/chat/conversations')
  cList(@PortalUser() u: PortalUserPayload) {
    return this.chat.list(cabinet(u));
  }

  @UseGuards(PortalAuthGuard)
  @Post('portal/chat/conversations')
  cOpen(@PortalUser() u: PortalUserPayload, @Body() dto: OpenConversationDto) {
    return this.chat.open(cabinet(u), dto);
  }

  @UseGuards(PortalAuthGuard)
  @Get('portal/chat/conversations/:id/messages')
  cMessages(@PortalUser() u: PortalUserPayload, @Param('id') id: string, @Query('before') before?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    return this.chat.messages(cabinet(u), id, { before, after, limit });
  }

  @UseGuards(PortalAuthGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('portal/chat/conversations/:id/messages')
  cSend(@PortalUser() u: PortalUserPayload, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(cabinet(u), id, dto);
  }

  @UseGuards(PortalAuthGuard)
  @Post('portal/chat/conversations/:id/read')
  cRead(@PortalUser() u: PortalUserPayload, @Param('id') id: string, @Body() dto: ReadDto) {
    return this.chat.markRead(cabinet(u), id, dto.seq);
  }

  @UseGuards(PortalAuthGuard)
  @Get('portal/chat/unread')
  cUnread(@PortalUser() u: PortalUserPayload) {
    return this.chat.unreadTotal(cabinet(u));
  }

  @UseGuards(PortalAuthGuard)
  @Get('portal/chat/contacts')
  cContacts(@PortalUser() u: PortalUserPayload) {
    return this.chat.contacts(cabinet(u));
  }

  @UseGuards(PortalAuthGuard)
  @SkipThrottle()
  @Get('portal/chat/stream')
  cStream(@PortalUser() u: PortalUserPayload, @Req() req: Request, @Res() res: Response) {
    this.hub.subscribe(cabinet(u), { iat: u.iat }, req, res);
  }
}
