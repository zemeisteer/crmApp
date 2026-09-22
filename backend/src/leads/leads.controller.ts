import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { ConvertLeadDto, CreateLeadDto, QueryLeadDto, UpdateLeadDto } from './dto/lead.dto';
import { LeadsService } from './leads.service';

@Controller('leads')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Roles('SUPERADMIN', 'ADMIN', 'TEACHER')
  findAll(@CurrentUser('tenantId') tenantId: string, @Query() query: QueryLeadDto) {
    return this.leadsService.findAll(tenantId, query);
  }

  @Get('funnel')
  @Roles('SUPERADMIN', 'ADMIN', 'TEACHER')
  getFunnelStats(@CurrentUser('tenantId') tenantId: string) {
    return this.leadsService.getFunnelStats(tenantId);
  }

  @Get(':id')
  @Roles('SUPERADMIN', 'ADMIN', 'TEACHER')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.leadsService.findOne(tenantId, id);
  }

  @Post()
  @Roles('SUPERADMIN', 'ADMIN')
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateLeadDto) {
    return this.leadsService.create(tenantId, dto);
  }

  @Patch(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(tenantId, id, dto);
  }

  @Post(':id/convert')
  @Roles('SUPERADMIN', 'ADMIN')
  convert(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: ConvertLeadDto,
  ) {
    return this.leadsService.convert(tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.leadsService.remove(tenantId, id);
  }
}
