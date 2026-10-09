import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/payment.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  // Center-wide payment data: management, finance staff and the front desk
  // (which takes payments) only.
  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('forMonth') forMonth?: string,
    @Query('studentId') studentId?: string,
    @Query('method') method?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list(tenantId, { page: page ? Number(page) || 1 : undefined, pageSize: pageSize ? Number(pageSize) : undefined, forMonth, studentId, method, status });
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get('summary')
  summary(@CurrentUser('tenantId') tenantId: string) {
    return this.service.summary(tenantId);
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get('debtors')
  getDebtors(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
    @Query('onlyDebtors') onlyDebtors?: string,
  ) {
    return this.service.getDebtors(tenantId, forMonth, onlyDebtors === 'true');
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get('finance-summary')
  getFinanceSummary(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
  ) {
    return this.service.getFinanceSummary(tenantId, forMonth);
  }

  @Roles('ADMIN', 'OWNER', 'MANAGER', 'ACCOUNTANT', 'RECEPTIONIST')
  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.service.create(tenantId, dto, userId, idempotencyKey);
  }
}
