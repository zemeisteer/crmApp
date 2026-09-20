import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { attachmentStorage, ATTACHMENT_MAX_SIZE } from '../common/upload.util';
import { TenantsService } from './tenants.service';
import { CreateTenantDto, UpdateTenantDto, UpdateTenantStatusDto } from './dto/tenant.dto';

class DeleteMyTenantDto {
  @IsString()
  password: string;
}

@Controller('tenants')
export class TenantsController {
  constructor(private readonly service: TenantsService) {}

  // Public: resolve a subdomain (used by the login page / public site)
  @Get('by-subdomain/:subdomain')
  findBySubdomain(@Param('subdomain') subdomain: string) {
    return this.service.findBySubdomain(subdomain);
  }

  // Platform superadmin only
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Tenant admin: edit own center's profile (name, accent color) — registered
  // before ':id' routes so Nest doesn't match "me" as an :id param.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Patch('me')
  updateMe(@CurrentUser('tenantId') tenantId: string, @Body() dto: UpdateTenantDto) {
    return this.service.updateMe(tenantId, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Post('me/logo')
  @UseInterceptors(FileInterceptor('file', { storage: attachmentStorage, limits: { fileSize: ATTACHMENT_MAX_SIZE } }))
  updateLogo(@CurrentUser('tenantId') tenantId: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.updateLogo(tenantId, file);
  }

  // GDPR-style self-service: an admin exports or deletes their own tenant's data.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Get('me/export')
  exportMe(@CurrentUser('tenantId') tenantId: string) {
    return this.service.exportData(tenantId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @Delete('me')
  deleteMe(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: DeleteMyTenantDto) {
    return this.service.deleteMyTenant(tenantId, userId, dto.password);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  // Platform superadmin: change any tenant's plan/status
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.service.updateStatus(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Post()
  create(@Body() dto: CreateTenantDto) {
    return this.service.createByAdmin(dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
