import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { NotificationsService } from './notifications.service';
import {
  QueryNotificationsDto,
  SendDebtorRemindersDto,
  SendNotificationDto,
  UpdateNotificationSettingsDto,
} from './dto/notification.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get('settings')
  @Roles('ADMIN', 'SUPERADMIN')
  getSettings(@CurrentUser() user: any) {
    return this.notificationsService.getSettings(user.tenantId);
  }

  @Patch('settings')
  @Roles('ADMIN', 'SUPERADMIN')
  updateSettings(
    @CurrentUser() user: any,
    @Body() dto: UpdateNotificationSettingsDto,
  ) {
    return this.notificationsService.updateSettings(user.tenantId, dto);
  }

  @Get('logs')
  @Roles('ADMIN', 'SUPERADMIN', 'MANAGER')
  getLogs(@CurrentUser() user: any, @Query() query: QueryNotificationsDto) {
    return this.notificationsService.getLogs(user.tenantId, query);
  }

  @Get('stats')
  @Roles('ADMIN', 'SUPERADMIN', 'MANAGER')
  getStats(@CurrentUser() user: any) {
    return this.notificationsService.getStats(user.tenantId);
  }

  @Post('test')
  @Roles('ADMIN', 'SUPERADMIN')
  sendTest(@CurrentUser() user: any, @Body() dto: SendNotificationDto) {
    return this.notificationsService.send(user.tenantId, dto);
  }

  @Post('debtor-reminders')
  @Roles('ADMIN', 'SUPERADMIN', 'ACCOUNTANT')
  sendDebtorReminders(
    @CurrentUser() user: any,
    @Body() dto: SendDebtorRemindersDto,
  ) {
    return this.notificationsService.notifyDebtors(
      user.tenantId,
      dto.forMonth,
      dto.studentIds,
    );
  }
}
