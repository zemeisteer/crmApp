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
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto, QueryAnnouncementDto } from './dto/announcement.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  @Roles('ADMIN', 'TEACHER')
  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @Query() query: QueryAnnouncementDto,
  ) {
    return this.service.findAll(tenantId, query);
  }

  // Every staff role sees the dashboard, so no @Roles here (the guard still
  // keeps students and parents out).
  @Get('banners')
  banners(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string) {
    return this.service.banners(tenantId, userId);
  }

  @Post(':id/read')
  markRead(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.markRead(tenantId, userId, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateAnnouncementDto,
  ) {
    return this.service.create(tenantId, userId, dto);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenantId, id);
  }
}
