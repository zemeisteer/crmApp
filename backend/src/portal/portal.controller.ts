import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { ATTACHMENT_MAX_SIZE, attachmentStorage } from '../common/upload.util';
import { Throttle } from '@nestjs/throttler';
import { PortalService } from './portal.service';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalUser, PortalUserPayload } from './portal-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

// Doing the work (homework, tests) is the student's own; parents watch.
function onlyStudent(user: PortalUserPayload) {
  if (user.viewer === 'parent') throw new ForbiddenException("Bu amalni o'quvchining o'zi bajaradi");
}

// Photos from a phone camera, PDFs and office documents.
const HOMEWORK_FILE_TYPES = /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf|application\/msword|application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document)$/;

@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  // Public portal authentication
  @Post('auth/token')
  loginWithToken(@Body('token') token: string) {
    return this.service.loginWithToken(token);
  }

  // Phone login in two steps: a code is sent to the student's Telegram
  // (or the center-issued PIN is used), then verified here.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('auth/phone/start')
  startPhoneLogin(@Body('phone') phone: string, @Body('subdomain') subdomain?: string) {
    return this.service.startPhoneLogin(String(phone ?? ''), typeof subdomain === 'string' ? subdomain : undefined);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('auth/phone/verify')
  verifyPhoneLogin(
    @Body('phone') phone: string,
    @Body('code') code?: string,
    @Body('pin') pin?: string,
    @Body('studentId') studentId?: string,
    @Body('subdomain') subdomain?: string,
  ) {
    return this.service.verifyPhoneLogin(String(phone ?? ''), {
      subdomain: typeof subdomain === 'string' ? subdomain : undefined,
      code: typeof code === 'string' ? code : undefined,
      pin: typeof pin === 'string' ? pin : undefined,
      studentId: typeof studentId === 'string' ? studentId : undefined,
    });
  }

  // A parent signed in with their own account: sessions for their children.
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT')
  @Post('auth/parent-account')
  parentAccount(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string) {
    return this.service.parentAccountSessions(tenantId, userId);
  }

  // Protected portal queries
  @UseGuards(PortalAuthGuard)
  @Get('me')
  async getMe(@PortalUser() user: PortalUserPayload) {
    return { ...(await this.service.getMe(user.studentId, user.tenantId)), viewer: user.viewer };
  }

  @UseGuards(PortalAuthGuard)
  @Get('schedule')
  getSchedule(@PortalUser() user: PortalUserPayload) {
    return this.service.getSchedule(user.studentId, user.tenantId);
  }

  // Past lessons with attendance, homework and results (?days=30, max 90).
  @UseGuards(PortalAuthGuard)
  @Get('lessons')
  getPastLessons(@PortalUser() user: PortalUserPayload, @Query('days') days?: string) {
    return this.service.getPastLessons(user.studentId, user.tenantId, days ? Number(days) : 30);
  }

  @UseGuards(PortalAuthGuard)
  @Get('attendance')
  getAttendance(@PortalUser() user: PortalUserPayload) {
    return this.service.getAttendance(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Get('homework')
  getHomework(@PortalUser() user: PortalUserPayload) {
    return this.service.getHomework(user.studentId, user.tenantId);
  }

  // The student hands in homework: optional text and an optional photo of
  // the notebook (or a PDF/doc). Plain JSON without a file still works.
  @UseGuards(PortalAuthGuard)
  @Post('homework/:id/submit')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: attachmentStorage,
      limits: { fileSize: ATTACHMENT_MAX_SIZE },
      fileFilter: (_req, file, cb) => cb(null, HOMEWORK_FILE_TYPES.test(file.mimetype)),
    }),
  )
  async submitHomework(
    @PortalUser() user: PortalUserPayload,
    @Param('id') id: string,
    @Body('text') text?: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      onlyStudent(user);
      return await this.service.submitHomework(user.studentId, user.tenantId, id, {
        text: typeof text === 'string' ? text : undefined,
        fileName: file?.filename,
      });
    } catch (err) {
      // A refused submission leaves no stray upload behind.
      if (file) await unlink(file.path).catch(() => undefined);
      throw err;
    }
  }

  @UseGuards(PortalAuthGuard)
  @Get('exams')
  getExams(@PortalUser() user: PortalUserPayload) {
    return this.service.getExams(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Get('exams/available')
  availableExams(@PortalUser() user: PortalUserPayload) {
    return this.service.getAvailableExams(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Get('exams/:id/start')
  startExam(@PortalUser() user: PortalUserPayload, @Param('id') id: string) {
    onlyStudent(user);
    return this.service.startExam(user.studentId, user.tenantId, id);
  }

  @UseGuards(PortalAuthGuard)
  @Post('exams/:id/submit')
  submitExam(@PortalUser() user: PortalUserPayload, @Param('id') id: string, @Body() body: { answers?: Record<string, string> }) {
    onlyStudent(user);
    const answers = body?.answers && typeof body.answers === 'object' ? body.answers : {};
    return this.service.submitExam(user.studentId, user.tenantId, id, answers);
  }

  @UseGuards(PortalAuthGuard)
  @Get('invoices')
  getInvoices(@PortalUser() user: PortalUserPayload) {
    return this.service.getInvoices(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Get('payments')
  getPayments(@PortalUser() user: PortalUserPayload) {
    return this.service.getPayments(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Post('payments/checkout-link')
  createCheckoutLink(
    @PortalUser() user: PortalUserPayload,
    @Body() body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string; invoiceId?: string },
  ) {
    return this.service.createCheckoutLink(user.studentId, user.tenantId, body);
  }

  @UseGuards(PortalAuthGuard)
  @Get('announcements')
  getAnnouncements(@PortalUser() user: PortalUserPayload) {
    return this.service.getAnnouncements(user.studentId, user.tenantId);
  }

  // Read state is kept per student; a parent reading marks it for the child.
  @UseGuards(PortalAuthGuard)
  @Post('announcements/read-all')
  readAllAnnouncements(@PortalUser() user: PortalUserPayload) {
    return this.service.markAnnouncementsRead(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Post('announcements/:id/read')
  readAnnouncement(@PortalUser() user: PortalUserPayload, @Param('id') id: string) {
    return this.service.markAnnouncementsRead(user.studentId, user.tenantId, id);
  }


  // ==================== PARENT PORTAL ====================

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students')
  getParentStudents(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
  ) {
    return this.service.getParentStudents(tenantId, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students/:studentId/overview')
  getParentStudentOverview(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.service.getParentStudentOverview(tenantId, userId, studentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students/:studentId/schedule')
  getParentStudentSchedule(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.service.getParentStudentSchedule(tenantId, userId, studentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students/:studentId/attendance')
  getParentStudentAttendance(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.service.getParentStudentAttendance(tenantId, userId, studentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students/:studentId/payments')
  getParentStudentPayments(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.service.getParentStudentPayments(tenantId, userId, studentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Get('parent/students/:studentId/invoices')
  getParentStudentInvoices(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.service.getParentStudentInvoices(tenantId, userId, studentId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('PARENT', 'ADMIN', 'OWNER')
  @Post('parent/students/:studentId/checkout-link')
  createParentCheckoutLink(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('studentId') studentId: string,
    @Body() body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string; invoiceId?: string },
  ) {
    return this.service.createParentCheckoutLink(tenantId, userId, studentId, body);
  }
}
