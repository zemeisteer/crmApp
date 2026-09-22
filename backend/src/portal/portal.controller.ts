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
  @Get('payments')
  getPayments(@PortalUser() user: PortalUserPayload) {
    return this.service.getPayments(user.studentId, user.tenantId);
  }

  @UseGuards(PortalAuthGuard)
  @Post('payments/checkout-link')
  createCheckoutLink(
    @PortalUser() user: PortalUserPayload,
    @Body() body: { provider: 'CLICK' | 'PAYME'; amount?: number; forMonth?: string },
  ) {
    return this.service.createCheckoutLink(user.studentId, user.tenantId, body);
  }

  @UseGuards(PortalAuthGuard)
  @Get('announcements')
  getAnnouncements(@PortalUser() user: PortalUserPayload) {
    return this.service.getAnnouncements(user.studentId, user.tenantId);
  }
}
