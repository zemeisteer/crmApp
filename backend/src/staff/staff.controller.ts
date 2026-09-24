import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Roles('ADMIN', 'OWNER')
@Controller('staff')
export class StaffController {
  constructor(private readonly service: StaffService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateStaffDto) {
    return this.service.create(tenantId, dto);
  }

  @Patch(':id')
  update(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @CurrentUser('sub') userId: string) {
    return this.service.remove(tenantId, id, userId);
  }
}
