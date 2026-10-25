import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { SignalsService } from './signals.service';

class ResolveSignalDto {
  @IsIn(['DONE', 'DISMISSED', 'OPEN'])
  status!: 'DONE' | 'DISMISSED' | 'OPEN';
}

// What the rules flagged and why: for the people who run the center.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER', 'MANAGER')
@Controller('signals')
export class SignalsController {
  constructor(private readonly service: SignalsService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query('status') status?: string, @Query('rule') rule?: string) {
    return this.service.list(tenantId, { status, rule });
  }

  @Patch(':id')
  resolve(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: ResolveSignalDto) {
    return this.service.resolve(tenantId, userId, id, dto.status);
  }
}
