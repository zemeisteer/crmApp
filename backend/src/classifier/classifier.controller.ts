import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ClassifierService } from './classifier.service';

class LabelDto {
  @IsString() @MaxLength(40) finalLabel!: string;
  @IsOptional() @IsString() @MaxLength(300) finalAction?: string;
}

// The model's suggestions next to what a person decided: to measure it
// before anything is switched on. Owners and admins only.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'OWNER')
@Controller('classifications')
export class ClassifierController {
  constructor(private readonly service: ClassifierService) {}

  @Get()
  list(@CurrentUser('tenantId') tenantId: string, @Query('labeled') labeled?: string) {
    return this.service.list(tenantId, { labeled });
  }

  @Patch(':id')
  label(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: LabelDto) {
    return this.service.label(tenantId, userId, id, dto);
  }
}
