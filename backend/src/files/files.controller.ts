import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { PortalAuthGuard } from '../portal/portal-auth.guard';
import { PortalUser, PortalUserPayload } from '../portal/portal-user.decorator';
import { FilesService } from './files.service';

export class SignFilesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  names!: string[];
}

// Links to uploaded files. Signing checks the caller against the record each
// file belongs to; the link itself is the only key the browser needs (an
// <img>/<audio> tag cannot send a bearer token).
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService) {}

  // Any staff member; what each may open is decided per file.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('files/sign')
  async signStaff(@CurrentUser() user: JwtPayload, @Body() dto: SignFilesDto) {
    if (!user.tenantId) return {};
    return this.files.signForStaff(user.tenantId, { role: user.role, userId: user.sub, access: user.access }, dto.names);
  }

  @UseGuards(PortalAuthGuard)
  @Post('portal/files/sign')
  signCabinet(@PortalUser() user: PortalUserPayload, @Body() dto: SignFilesDto) {
    return this.files.signForCabinet(user.tenantId, user.studentId, dto.names);
  }

  // The signature is the authorization; a page full of pictures or a
  // recording's range requests must not hit the request limit.
  @SkipThrottle()
  @Get('files/:name')
  serve(@Param('name') name: string, @Query('e') e: unknown, @Query('s') s: unknown, @Res() res: Response) {
    this.files.serveSigned(name, e, s, res);
  }
}
