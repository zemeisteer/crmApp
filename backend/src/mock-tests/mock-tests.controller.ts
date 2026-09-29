import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { MockImportService } from './import/mock-import.service';
import { unlink } from 'fs/promises';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { attachmentStorage } from '../common/upload.util';
import { MockTestsService } from './mock-tests.service';
import { CreateMockTestDto, GenerateMockQuestionsDto, RegradeMockAttemptDto, ReviewMockAttemptDto, ReviewPracticeDto, UpdateMockTestDto } from './dto/mock-tests.dto';
import { AiService } from '../ai/ai.service';

// Recordings for Listening and pictures (charts) for Writing Task 1.
const ASSET_TYPES = /^(audio\/(mpeg|mp3|mp4|x-m4a|aac|wav|x-wav|ogg|webm)|image\/(jpeg|png|webp|gif))$/;

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Roles('ADMIN', 'MANAGER', 'TEACHER')
@Controller('mock-tests')
export class MockTestsController {
  constructor(
    private readonly service: MockTestsService,
    private readonly imports: MockImportService,
    private readonly ai: AiService,
  ) {}

  // Questions for a practice test part, written by the AI (the editor adds
  // them; the teacher checks them before publishing).
  @Post('generate-questions')
  generateQuestions(@Body() dto: GenerateMockQuestionsDto) {
    return this.ai.generateExamQuestions({ subject: dto.subject, topic: dto.topic?.trim() || dto.subject, count: dto.count ?? 8, request: dto.request ?? null });
  }

  // Materials -> tests: PDF books/booklets (answer keys, audioscripts) and
  // recordings. The tests are found and extracted in the background.
  @Post('import')
  @UseInterceptors(FilesInterceptor('files', 40, {
    storage: attachmentStorage,
    limits: { fileSize: 150 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf' || file.mimetype.startsWith('audio/')),
  }))
  async startImport(@CurrentUser('tenantId') tenantId: string, @UploadedFiles() files: Express.Multer.File[] = []) {
    try {
      return await this.imports.start(tenantId, files.map((f) => ({ path: f.filename, name: f.originalname, type: f.mimetype, size: f.size })));
    } catch (err) {
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
      throw err;
    }
  }

  @Get('imports')
  importsList(@CurrentUser('tenantId') tenantId: string) {
    return this.imports.list(tenantId);
  }

  @Get('imports/:importId')
  importOne(@CurrentUser('tenantId') tenantId: string, @Param('importId') importId: string) {
    return this.imports.get(tenantId, importId);
  }

  @Get()
  list(@CurrentUser('tenantId') tenantId: string) {
    return this.service.list(tenantId);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateMockTestDto) {
    return this.service.create(tenantId, dto);
  }

  @Get('attempts/:attemptId')
  attempt(@CurrentUser('tenantId') tenantId: string, @Param('attemptId') attemptId: string) {
    return this.service.attemptDetail(tenantId, attemptId);
  }

  @Post('attempts/:attemptId/review')
  review(@CurrentUser('tenantId') tenantId: string, @Param('attemptId') attemptId: string, @Body() dto: ReviewMockAttemptDto) {
    return this.service.review(tenantId, attemptId, dto).then(() => this.service.attemptDetail(tenantId, attemptId));
  }

  @Post('attempts/:attemptId/review-practice')
  reviewPractice(@CurrentUser('tenantId') tenantId: string, @Param('attemptId') attemptId: string, @Body() dto: ReviewPracticeDto) {
    return this.service.reviewPractice(tenantId, attemptId, dto);
  }

  @Post('attempts/:attemptId/regrade')
  regrade(@CurrentUser('tenantId') tenantId: string, @Param('attemptId') attemptId: string, @Body() dto: RegradeMockAttemptDto) {
    return this.service.regrade(tenantId, attemptId, dto.section);
  }

  @Get(':id')
  get(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.get(tenantId, id);
  }

  @Get(':id/attempts')
  attempts(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.attempts(tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: UpdateMockTestDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Roles('ADMIN', 'MANAGER')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }

  // Uploads a file for the test; the editor puts the returned path into the
  // content (a Listening part's audio, a Writing task's picture).
  @Post(':id/asset')
  @UseInterceptors(FileInterceptor('file', {
    storage: attachmentStorage,
    limits: { fileSize: 40 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, ASSET_TYPES.test(file.mimetype)),
  }))
  async asset(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Audio (mp3, m4a, wav, ogg) yoki rasm yuklang');
    await this.service.get(tenantId, id);
    return { path: file.filename, name: file.originalname, type: file.mimetype };
  }
}
