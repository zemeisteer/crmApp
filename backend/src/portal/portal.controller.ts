import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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

  @UseGuards(PortalAuthGuard)
  @Post('homework/:id/submit')
  submitHomework(
    @PortalUser() user: PortalUserPayload,
    @Param('id') id: string,
  ) {
    onlyStudent(user);
    return this.service.submitHomework(user.studentId, user.tenantId, id);
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
