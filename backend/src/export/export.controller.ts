import {
  Controller,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { ExportService } from './export.service';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Roles('ADMIN', 'ACCOUNTANT')
@Controller('export')
export class ExportController {
  constructor(private readonly service: ExportService) {}

  @Get('students.xlsx')
  async studentsXlsx(@CurrentUser('tenantId') tenantId: string, @Res() res: Response) {
    const buffer = await this.service.studentsWorkbook(tenantId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="oquvchilar.xlsx"',
    });
    res.send(Buffer.from(buffer));
  }

  @Get('payments.xlsx')
  async paymentsXlsx(@CurrentUser('tenantId') tenantId: string, @Res() res: Response) {
    const buffer = await this.service.paymentsWorkbook(tenantId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="tolovlar.xlsx"',
    });
    res.send(Buffer.from(buffer));
  }

  @Post('students/import')
  @UseInterceptors(FileInterceptor('file'))
  async importStudents(@CurrentUser('tenantId') tenantId: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.importStudents(tenantId, file.buffer);
  }

  @Get('payments/:id/receipt.pdf')
  async receiptPdf(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const buffer = await this.service.paymentReceiptPdf(tenantId, id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="kvitansiya-${id}.pdf"`,
    });
    res.send(buffer);
  }
}
