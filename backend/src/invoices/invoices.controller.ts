import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto, QueryInvoicesDto } from './dto/invoice.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Roles('ADMIN', 'OWNER', 'ACCOUNTANT')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryInvoicesDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.service.create(tenantId, dto, userId);
  }

  @Post('generate-monthly')
  generateMonthly(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body('forMonth') forMonth?: string,
  ) {
    return this.service.generateMonthly(tenantId, forMonth, userId);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.cancel(tenantId, id, userId);
  }
}
