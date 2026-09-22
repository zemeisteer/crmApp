import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { attachmentStorage, ATTACHMENT_MAX_SIZE } from '../common/upload.util';
import { ExamsService } from './exams.service';
import {
  CreateExamDto,
  CreateExamQuestionDto,
  BatchCreateQuestionsDto,
  SubmitAttemptDto,
  SubmitResultsDto,
} from './dto/exam.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('exams')
export class ExamsController {
  constructor(private readonly service: ExamsService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query('groupId') groupId?: string) {
    return this.service.findAll(tenantId, groupId);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateExamDto) {
    return this.service.create(tenantId, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/material')
  @UseInterceptors(FileInterceptor('file', { storage: attachmentStorage, limits: { fileSize: ATTACHMENT_MAX_SIZE } }))
  attachMaterial(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.attachMaterial(tenantId, id, file);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/results')
  submitResults(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string, @Body() dto: SubmitResultsDto) {
    return this.service.submitResults(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }

  // ---- Questions & Question Bank Endpoints ----

  @Roles('ADMIN', 'TEACHER')
  @Get(':id/questions')
  getQuestions(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.getQuestions(tenantId, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/questions')
  createQuestion(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateExamQuestionDto,
  ) {
    return this.service.createQuestion(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/questions/batch')
  batchCreateQuestions(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: BatchCreateQuestionsDto,
  ) {
    return this.service.batchCreateQuestions(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete(':id/questions/:questionId')
  removeQuestion(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('questionId') questionId: string,
  ) {
    return this.service.removeQuestion(tenantId, id, questionId);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/generate-questions')
  generateQuestions(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.generateQuestionsWithAi(tenantId, id);
  }

  // ---- Interactive Test Taking Endpoints ----

  @Get(':id/start-attempt')
  startAttempt(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Query('studentId') studentId: string,
  ) {
    return this.service.startAttempt(tenantId, id, studentId);
  }

  @Post(':id/submit-attempt')
  submitAttempt(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: SubmitAttemptDto,
  ) {
    return this.service.submitAttempt(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Get(':id/attempts')
  getAttempts(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.getAttempts(tenantId, id);
  }
}
