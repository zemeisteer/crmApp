import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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
import { HomeworkService } from './homework.service';
import {
  CreateHomeworkDto,
  UpdateHomeworkDto,
  SetCompletionDto,
  SubmitHomeworkDto,
  GradeHomeworkDto,
} from './dto/homework.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('homework')
export class HomeworkController {
  constructor(private readonly service: HomeworkService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @Query('groupId') groupId?: string) {
    return this.service.findAll(tenantId, groupId);
  }

  // Must precede ':id'
  @Get('leaderboard')
  getLeaderboard(@CurrentUser('tenantId') tenantId: string, @Query('groupId') groupId?: string) {
    return this.service.getLeaderboard(tenantId, groupId);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Get(':id/roster')
  getRoster(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.getRoster(tenantId, id);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/completions')
  setCompletion(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: SetCompletionDto,
  ) {
    return this.service.setCompletion(tenantId, id, dto);
  }

  @Post(':id/submit')
  submit(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: SubmitHomeworkDto,
  ) {
    return this.service.submit(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/grade')
  grade(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: GradeHomeworkDto,
  ) {
    return this.service.grade(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateHomeworkDto) {
    return this.service.create(tenantId, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateHomeworkDto,
  ) {
    return this.service.update(tenantId, id, dto);
  }

  @Roles('ADMIN', 'TEACHER')
  @Post(':id/attachment')
  @UseInterceptors(
    FileInterceptor('file', { storage: attachmentStorage, limits: { fileSize: ATTACHMENT_MAX_SIZE } }),
  )
  attach(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.attach(tenantId, id, file);
  }

  @Roles('ADMIN', 'TEACHER')
  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.service.remove(tenantId, id);
  }
}
