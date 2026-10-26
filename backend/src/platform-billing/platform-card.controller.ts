import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { unlink } from 'fs/promises';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ATTACHMENT_MAX_SIZE, attachmentStorage, setUploadHeaders } from '../common/upload.util';
import { PlatformCardService } from './platform-card.service';

// A receipt: a screenshot or photo, or the bank's PDF.
const RECEIPT_FILE_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

class RejectDto {
  @IsString() @MaxLength(300) reason!: string;
}

class ClaimBody {
  @IsString() @MaxLength(60) plan!: string;
  @IsString() @MaxLength(7) forMonth!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

// The center's side: the platform's card and "we paid" with a receipt.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('platform-billing/card')
export class PlatformCardController {
  constructor(private readonly service: PlatformCardService) {}

  @Get()
  view(@CurrentUser('tenantId') tenantId: string) {
    return this.service.centerView(tenantId);
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: attachmentStorage,
      limits: { fileSize: ATTACHMENT_MAX_SIZE },
      fileFilter: (_req, file, cb) => cb(null, RECEIPT_FILE_TYPES.test(file.mimetype)),
    }),
  )
  async send(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Body() body: ClaimBody, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Chek rasmini (skrinshot) yuklang: JPG, PNG yoki PDF");
    try {
      return await this.service.submit(tenantId, userId, { plan: body.plan, forMonth: body.forMonth, note: body.note, receiptFile: file.filename });
    } catch (err) {
      await unlink(file.path).catch(() => undefined);
      throw err;
    }
  }
}

// The platform admin's side: every center's receipts, confirmed or rejected.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('platform/card-claims')
export class PlatformCardAdminController {
  constructor(private readonly service: PlatformCardService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status);
  }

  @Get(':id/receipt')
  async receipt(@Param('id') id: string, @Res() res: Response) {
    const { path, name } = await this.service.receiptPath(id);
    setUploadHeaders(res, name);
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path, { dotfiles: 'deny' });
  }

  @Post(':id/confirm')
  confirm(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.confirm(userId, id);
  }

  @Post(':id/reject')
  reject(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: RejectDto) {
    return this.service.reject(userId, id, dto.reason);
  }
}
