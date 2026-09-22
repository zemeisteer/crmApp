import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
export class ExpensesController {
  constructor(private readonly service: ExpensesService) {}

  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
    @Query('category') category?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.findAll(tenantId, { forMonth, category, branchId });
  }

  @Get('summary')
  summary(
    @CurrentUser('tenantId') tenantId: string,
    @Query('forMonth') forMonth?: string,
  ) {
    return this.service.summary(tenantId, forMonth);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.service.create(tenantId, userId, dto);
  }

  @Roles('ADMIN', 'ACCOUNTANT')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.service.update(tenantId, userId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  delete(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(tenantId, userId, id);
  }
}
