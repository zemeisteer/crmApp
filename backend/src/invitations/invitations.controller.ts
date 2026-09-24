import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthService } from '../auth/auth.service';

@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.create(tenantId, userId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.invitationsService.findAll(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @Delete(':id')
  revoke(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.invitationsService.revoke(tenantId, id);
  }

  // Public endpoints for accepting invites with rate limiting
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Get(':token/validate')
  validateToken(@Param('token') token: string) {
    return this.invitationsService.validateToken(token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
    @Req() req: Request,
  ) {
    let authenticatedUserId: string | undefined;
    const authHeader = (req.headers as any)?.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      const tokenStr = authHeader.slice(7);
      const payload = this.authService.verifyAccessToken(tokenStr);
      if (payload?.sub) {
        authenticatedUserId = payload.sub;
      }
    }
    return this.invitationsService.accept(token, dto, authenticatedUserId);
  }
}
