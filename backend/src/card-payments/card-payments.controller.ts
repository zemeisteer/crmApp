import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { CardPaymentsService } from './card-payments.service';
import { ConfirmClaimDto, RejectClaimDto, SetCardDto } from './card-payments.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('card-payments')
export class CardPaymentsController {
  constructor(private readonly service: CardPaymentsService) {}

  // The center's card, set by its admins.
  @Roles('ADMIN', 'OWNER')
  @Get('card')
  async card(@CurrentUser('tenantId') tenantId: string) {
    return { card: await this.service.card(tenantId) };
  }

  @Roles('ADMIN', 'OWNER')
  @Put('card')
  setCard(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: SetCardDto) {
    return this.service.setCard(tenantId, userId, dto);
  }

  // Receipts sent from the cabinet: seen by whoever sees payments, decided by whoever takes them.
  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get('claims')
  list(@CurrentUser('tenantId') tenantId: string, @Query('status') status?: string) {
    return this.service.list(tenantId, status);
  }

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Post('claims/:id/confirm')
  confirm(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: ConfirmClaimDto) {
    return this.service.confirm(tenantId, userId, id, dto.amount);
  }

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Post('claims/:id/reject')
  reject(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: RejectClaimDto) {
    return this.service.reject(tenantId, userId, id, dto.reason);
  }
}
