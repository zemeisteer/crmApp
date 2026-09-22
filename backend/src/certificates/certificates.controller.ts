import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { CertificatesService } from './certificates.service';
import { CreateCertificateDto, QueryCertificateDto } from './dto/certificate.dto';

@Controller('certificates')
export class CertificatesController {
  constructor(private readonly service: CertificatesService) {}

  // 1. Public certificate verification (Master Spec Section 23)
  // No auth required, returns minimal safe public details
  @Get('verify/:code')
  verifyPublic(@Param('code') code: string) {
    return this.service.verifyPublic(code);
  }

  // 2. Protected tenant management endpoints
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryCertificateDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateCertificateDto,
  ) {
    return this.service.create(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenantId, id);
  }
}
