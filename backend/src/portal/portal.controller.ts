import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PortalService } from './portal.service';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalUser, PortalUserPayload } from './portal-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

@Controller('portal')
export class PortalController {
  constructor(private readonly service: PortalService) {}

  // Public portal authentication
  @Post('auth/token')
  loginWithToken(@Body('token') token: string) {
    return this.service.loginWithToken(token);
  }

  @Post('auth/phone')
  loginWithPhone(
    @Body('phone') phone: string,
    @Body('studentCode') studentCode?: string,
  ) {
    return this.service.loginWithPhone(phone, studentCode);
  }

  @Post('auth/telegram')
  loginWithTelegram(@Body('chatId') chatId: string) {
    return this.service.loginWithTelegram(chatId);
  }

  // Protected portal queries
  @UseGuards(PortalAuthGuard)
  @Get('me')
  getMe(@PortalUser() user: PortalUserPayload) {
    return this.service.getMe(user.studentId, user.tenantId);
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
    return this.service.submitHomework(user.studentId, user.tenantId, id);
  }

  @UseGuards(PortalAuthGuard)
  @Get('exams')
  getExams(@PortalUser() user: PortalUserPayload) {
    return this.service.getExams(user.studentId, user.tenantId);
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
