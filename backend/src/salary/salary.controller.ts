import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { SalaryService } from './salary.service';
import { DisburseSalaryDto } from './dto/salary.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('salary-payments')
export class SalaryController {
  constructor(private readonly service: SalaryService) {}

  // The signed-in teacher's own pay for a month (same engine as payroll).
  @Roles('TEACHER')
  @Get('me')
  mine(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Query('forMonth') forMonth?: string) {
    return this.service.forTeacherUser(tenantId, userId, forMonth);
  }

  // Every payout to every teacher: finance staff only.
  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query('teacherId') teacherId?: string, @Query('forMonth') forMonth?: string) {
    return this.service.findAll(tenantId, teacherId, forMonth);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('calculate')
  calculatePayroll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
  ) {
    return this.service.calculatePayroll(tenantId, forMonth);
  }

  // Read-only: salary records from before payouts were linked to expenses.
  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Get('reconciliation')
  reconciliation(@CurrentUser('tenantId') tenantId: string, @Query('forMonth') forMonth?: string) {
    return this.service.reconciliation(tenantId, forMonth);
  }

  // A payout (one installment) and its expense, in one transaction. A retry
  // with the same Idempotency-Key returns the first payout.
  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('disburse')
  async disburse(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: DisburseSalaryDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const { replayed: _replayed, ...result } = await this.service.disburse(tenantId, dto, userId, idempotencyKey);
    return result;
  }
}
