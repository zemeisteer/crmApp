import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ATTACHMENT_MAX_SIZE } from '../common/upload.util';
import { PlacementService } from './placement.service';
import { CreatePlacementTestDto, SetPlacementActiveDto, SubmitPlacementDto } from './placement.dto';

const STAFF = ['ADMIN', 'OWNER', 'MANAGER', 'TEACHER', 'RECEPTIONIST'];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('placement-tests')
export class PlacementController {
  constructor(private readonly service: PlacementService) {}

  @Roles(...STAFF)
  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.service.list(tenantId);
  }

  @Roles(...STAFF)
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() dto: CreatePlacementTestDto) {
    return this.service.create(tenantId, userId, dto);
  }

  // Reads questions from a PDF for review; nothing is saved.
  @Roles(...STAFF)
  @Post('parse-pdf')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: ATTACHMENT_MAX_SIZE },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
  }))
  parsePdf(@UploadedFile() file: Express.Multer.File) {
    return this.service.parsePdf(file);
  }

  @Roles(...STAFF)
  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @Roles(...STAFF)
  @Get(':id/attempts')
  attempts(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.attempts(tenantId, id);
  }

  @Roles(...STAFF)
  @Patch(':id')
  setActive(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: SetPlacementActiveDto) {
    return this.service.setActive(tenantId, id, dto.active);
  }
}

// Anonymous: anyone with the link can open and submit the test.
@Controller('public/placement')
export class PublicPlacementController {
  constructor(private readonly service: PlacementService) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.publicGet(token);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':token/submit')
  submit(@Param('token') token: string, @Body() dto: SubmitPlacementDto) {
    return this.service.publicSubmit(token, dto);
  }
}
