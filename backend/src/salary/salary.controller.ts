import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { SalaryService } from './salary.service';
import { CreateSalaryPaymentDto } from './dto/salary.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('salary-payments')
export class SalaryController {
  constructor(private readonly service: SalaryService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query('teacherId') teacherId?: string) {
    return this.service.findAll(tenantId, teacherId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateSalaryPaymentDto) {
    return this.service.create(tenantId, dto);
  }
}
