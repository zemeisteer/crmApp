import { Body, Controller, Header, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AiService } from './ai.service';
import { GenerateMaterialDto, GroupInsightsDto, RenderPdfDto, SuggestHomeworkDto } from './dto/ai.dto';
import { pdfFileName, renderTextPdf } from '../common/text-pdf';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Post('insights')
  insights(@CurrentUser('tenantId') tenantId: string, @Body() dto: GroupInsightsDto) {
    return this.service.groupInsights(tenantId, dto.groupId);
  }

  @Post('materials')
  materials(@Body() dto: GenerateMaterialDto) {
    return this.service.generateMaterial(dto);
  }

  @Post('suggest-homework')
  suggestHomework(@Body() dto: SuggestHomeworkDto) {
    return this.service.suggestHomework(dto);
  }

  // A material as a PDF file to download or print.
  @Post('pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Body() dto: RenderPdfDto) {
    const bytes = await renderTextPdf({ title: dto.title, subtitle: dto.subtitle, body: dto.content });
    return new StreamableFile(bytes, { disposition: `attachment; filename="${encodeURIComponent(pdfFileName(dto.title))}"` });
  }
}

