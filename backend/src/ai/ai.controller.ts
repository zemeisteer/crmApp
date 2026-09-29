import { Body, Controller, Get, Header, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AiService } from './ai.service';
import { StudentTutorService } from './student-tutor.service';
import { GenerateMaterialDto, GroupInsightsDto, RenderPdfDto, SuggestHomeworkDto, TutorReportDto } from './dto/ai.dto';
import { pdfFileName, renderTextPdf } from '../common/text-pdf';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly service: AiService,
    private readonly tutor: StudentTutorService,
  ) {}

  // What a group's students asked the AI tutor (teachers: own groups only).
  @Get('tutor-report')
  tutorReport(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Query() q: TutorReportDto,
  ) {
    return this.tutor.groupReport(tenantId, q.groupId, q.days ?? 14, role, userId);
  }

  @Post('tutor-report/topics')
  tutorTopics(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: TutorReportDto,
  ) {
    return this.tutor.groupTopics(tenantId, dto.groupId, dto.days ?? 14, role, userId);
  }

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

