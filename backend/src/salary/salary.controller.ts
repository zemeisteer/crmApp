import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { SalaryService } from './salary.service';
import { CreateSalaryPaymentDto, DisburseSalaryDto } from './dto/salary.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('salary-payments')
export class SalaryController {
  constructor(private readonly service: SalaryService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query('teacherId') teacherId?: string) {
    return this.service.findAll(tenantId, teacherId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Get('calculate')
  calculatePayroll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
  ) {
    return this.service.calculatePayroll(tenantId, forMonth);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post('disburse')
  disburse(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: DisburseSalaryDto,
  ) {
    return this.service.disburse(tenantId, dto, userId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateSalaryPaymentDto) {
    return this.service.create(tenantId, dto);
  }
}
