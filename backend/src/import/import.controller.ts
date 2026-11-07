import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ImportService } from './import.service';
import { parseMapping, type ImportKind } from './import-sheet';

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

  // Everything at once: one workbook (a sheet per kind) or a .zip of the single templates.
  @Get('bundle/template.xlsx')
  async bundleTemplate(@CurrentUser('tenantId') tenantId: string, @Res() res: Response) {
    const buffer = await this.service.bundleTemplate(tenantId);
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': 'attachment; filename="import-hammasi.xlsx"' });
    res.send(Buffer.from(buffer));
  }

  @Post('bundle')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async bundle(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length) throw new BadRequestException('Excel yoki ZIP fayl yuklang (maydon nomi: file)');
    return this.service.runBundle(tenantId, userId, file.buffer);
  }

  @Get(':kind/template.xlsx')
  async template(@CurrentUser('tenantId') tenantId: string, @Param('kind') kind: string, @Res() res: Response) {
    const k = kindOf(kind);
    const buffer = await this.service.template(k, tenantId);
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="import-${k}.xlsx"` });
    res.send(Buffer.from(buffer));
  }

  // The file's columns and the suggested field for each (nothing is checked or saved).
  @Post(':kind/columns')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async columns(@CurrentUser('tenantId') tenantId: string, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File | undefined) {
    const k = kindOf(kind);
    if (!file?.buffer?.length) throw new BadRequestException('Excel fayl yuklang (maydon nomi: file)');
    return this.service.columns(tenantId, k, file.buffer);
  }

  @Post(':kind')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('kind') kind: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('dryRun') dryRun?: string,
    // Which column is which field (JSON), as the person chose; without it the headers decide.
    @Body('mapping') rawMapping?: string,
  ) {
    const k = kindOf(kind);
    if (!file?.buffer?.length) throw new BadRequestException('Excel fayl yuklang (maydon nomi: file)');
    let mapping: ReturnType<typeof parseMapping>;
    try {
      mapping = parseMapping(k, rawMapping);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (dryRun === '1' || dryRun === 'true') return this.service.preview(tenantId, k, file.buffer, mapping ?? undefined);
    return this.service.run(tenantId, userId, k, file.buffer, mapping ?? undefined);
  }
}
