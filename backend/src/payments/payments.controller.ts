import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
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

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get('summary')
  summary(@CurrentUser('tenantId') tenantId: string) {
    return this.service.summary(tenantId);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreatePaymentDto) {
    return this.service.create(tenantId, dto);
  }
}
