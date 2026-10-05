import { BadRequestException, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ImportService } from './import.service';
import type { ImportKind } from './import-sheet';

const KINDS: ImportKind[] = ['teachers', 'groups', 'students'];
const kindOf = (k: string): ImportKind => {
  if (!KINDS.includes(k as ImportKind)) throw new BadRequestException("Import turi: teachers, groups yoki students");
  return k as ImportKind;
};
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Excel import of teachers, groups and students: a template, a preview that
// writes nothing, and the run (all rows valid, or nothing is saved).
// Admins (and the owner) only, as the forms that create these.
@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Roles('ADMIN')
@Controller('import')
export class ImportController {
  constructor(private readonly service: ImportService) {}

  @Get(':kind/template.xlsx')
  async template(@Param('kind') kind: string, @Res() res: Response) {
    const k = kindOf(kind);
    const buffer = await this.service.template(k);
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="import-${k}.xlsx"` });
    res.send(Buffer.from(buffer));
  }

  @Post(':kind')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
  ) {
    const k = kindOf(kind);
    if (!file?.buffer?.length) throw new BadRequestException('Excel fayl yuklang (maydon nomi: file)');
    if (dryRun === '1' || dryRun === 'true') return this.service.preview(tenantId, k, file.buffer);
    return this.service.run(tenantId, userId, k, file.buffer);
  }
}
