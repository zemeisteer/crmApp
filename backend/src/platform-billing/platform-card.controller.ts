import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { unlink } from 'fs/promises';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ATTACHMENT_MAX_SIZE, attachmentStorage, setUploadHeaders, sha256File } from '../common/upload.util';
import { PlatformCardService } from './platform-card.service';

// A receipt: a screenshot or photo, or the bank's PDF.
const RECEIPT_FILE_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;

class RejectDto {
  @IsString() @MaxLength(300) reason!: string;
}

class ClaimBody {
  @IsString() @MaxLength(60) plan!: string;
  // Ignored: the month is the server's (the next month to pay).
  @IsOptional() @IsString() @MaxLength(7) forMonth?: string;
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
  async send(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() body: ClaimBody,
    @Headers('idempotency-key') idempotencyKey?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException("Chek rasmini (skrinshot) yuklang: JPG, PNG yoki PDF");
    try {
      // The receipt's own content, not its random stored name: a retry of the same picture is the same send.
      const receiptSha256 = await sha256File(file.path);
      const { claim, replay } = await this.service.submit(tenantId, userId, { plan: body.plan, note: body.note, receiptFile: file.filename, receiptSha256, idempotencyKey });
      // A retried send: the first upload is the receipt; this copy goes (never the one in use).
      if (replay && claim.receiptFile !== file.filename) await unlink(file.path).catch(() => undefined);
      return { ...claim, idempotencyKey: undefined, requestHash: undefined, receiptSha256: undefined, replay };
    } catch (err) {
      // A refused upload leaves no file behind.
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
  list(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.service.list({ status, page: Number(page), pageSize: Number(pageSize) });
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
