import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { CashService } from './cash.service';
import { CloseCashDayDto } from './dto/cash.dto';

// The cash desk by day: who took what, by method; expenses; what should be
// in the drawer; closing the day with the counted cash.
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('cash')
export class CashController {
  constructor(private readonly service: CashService) {}

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT', 'MANAGER', 'RECEPTIONIST')
  @Get('day')
  day(@CurrentUser('tenantId') tenantId: string, @Query('date') date?: string) {
    return this.service.get(tenantId, date || undefined);
  }

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT', 'MANAGER', 'RECEPTIONIST')
  @Get('closings')
  closings(@CurrentUser('tenantId') tenantId: string, @Query('month') month: string) {
    return this.service.history(tenantId, month ?? '');
  }

  // Closing takes someone who answers for the money.
  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Post('day/close')
  close(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CloseCashDayDto) {
    return this.service.close(tenantId, userId, dto.date, dto.countedCash, dto.note);
  }
}
