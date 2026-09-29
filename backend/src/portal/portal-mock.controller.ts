import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { attachmentStorage } from '../common/upload.util';
import { MockTestsService } from '../mock-tests/mock-tests.service';
import type { Section } from '../mock-tests/ielts';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalUser, PortalUserPayload } from './portal-user.decorator';

const only = (user: PortalUserPayload) => {
  if (user.viewer === 'parent') throw new ForbiddenException("Bu amalni o'quvchining o'zi bajaradi");
};

// The practice area in the cabinet: mock tests by the student's directions.
// Parents can look; only the student sits the test.
@UseGuards(PortalAuthGuard)
@Controller('portal/mock-tests')
export class PortalMockController {
  constructor(private readonly service: MockTestsService) {}

  @Get()
  list(@PortalUser() user: PortalUserPayload) {
    return this.service.forStudent(user.studentId, user.tenantId);
  }

  @Post(':testId/start')
  start(@PortalUser() user: PortalUserPayload, @Param('testId') testId: string) {
    only(user);
    return this.service.start(user.studentId, user.tenantId, testId);
  }

  @Get('attempts/:id')
  attempt(@PortalUser() user: PortalUserPayload, @Param('id') id: string) {
    return this.service.attemptForStudent(user.studentId, user.tenantId, id);
  }

  @Post('attempts/:id/sections/:section/start')
  startSection(@PortalUser() user: PortalUserPayload, @Param('id') id: string, @Param('section') section: Section) {
    only(user);
    return this.service.startSection(user.studentId, user.tenantId, id, section);
  }

  @Post('attempts/:id/sections/:section/answers')
  save(@PortalUser() user: PortalUserPayload, @Param('id') id: string, @Param('section') section: Section, @Body('answers') answers: unknown) {
    only(user);
    return this.service.saveAnswers(user.studentId, user.tenantId, id, section, answers);
  }

  @Post('attempts/:id/sections/:section/submit')
  submit(@PortalUser() user: PortalUserPayload, @Param('id') id: string, @Param('section') section: Section, @Body('answers') answers?: unknown) {
    only(user);
    return this.service.submitSection(user.studentId, user.tenantId, id, section, answers);
  }

  // One Speaking answer: the recording (webm/ogg/mp4 from the browser) and
  // the browser's transcript, key "part.question" (e.g. "1.0").
  @Post('attempts/:id/speaking/:key')
  @UseInterceptors(FileInterceptor('audio', {
    storage: attachmentStorage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => cb(null, /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a)(;.*)?$/.test(file.mimetype)),
  }))
  async speaking(
    @PortalUser() user: PortalUserPayload,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body('transcript') transcript?: string,
    @Body('seconds') seconds?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      only(user);
      if (!file && !transcript) throw new BadRequestException('Javob yozib olinmadi');
      return await this.service.saveSpeaking(user.studentId, user.tenantId, id, key, {
        audio: file?.filename,
        transcript: typeof transcript === 'string' ? transcript : undefined,
        seconds: seconds !== undefined ? Number(seconds) : undefined,
      });
    } catch (err) {
      if (file) await unlink(file.path).catch(() => undefined);
      throw err;
    }
  }
}
