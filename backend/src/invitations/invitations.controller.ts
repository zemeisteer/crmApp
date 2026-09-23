import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

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

  // Public endpoints for accepting invites
  @Get(':token/validate')
  validateToken(@Param('token') token: string) {
    return this.invitationsService.validateToken(token);
  }

  @Post(':token/accept')
  accept(
    @Param('token') token: string,
    @Body() dto: AcceptInvitationDto,
  ) {
    return this.invitationsService.accept(token, dto);
  }
}
