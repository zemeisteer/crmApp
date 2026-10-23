import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { HiringService } from './hiring.service';
import { CreateCandidateDto, QueryCandidatesDto, UpdateCandidateDto } from './hiring.dto';

// Hiring is the center's management work: owners, admins and managers.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER', 'MANAGER')
@Controller('hiring/candidates')
export class HiringController {
  constructor(private readonly service: HiringService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query() query: QueryCandidatesDto) {
    return this.service.list(tenantId, query);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CreateCandidateDto) {
    return this.service.create(tenantId, userId, dto);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: UpdateCandidateDto) {
    return this.service.update(tenantId, userId, id, dto);
  }

  // Makes the candidate a teacher (teachers are added by admins only).
  @Roles('ADMIN', 'OWNER')
  @Post(':id/hire')
  hire(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.hire(tenantId, userId, id);
  }

  @Delete(':id')
  archive(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.archive(tenantId, userId, id);
  }
}
