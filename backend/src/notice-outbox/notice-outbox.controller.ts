import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { NoticeOutboxService } from './notice-outbox.service';

// The platform admin sees the payment messages that could not be sent, and sends them again.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('platform/notice-outbox')
export class NoticeOutboxController {
  constructor(private readonly outbox: NoticeOutboxService) {}

  @Get()
  list(@Query('status') status?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.outbox.list({ status, page: Number(page), pageSize: Number(pageSize) });
  }

  @Post(':id/retry')
  retry(@Param('id') id: string) {
    return this.outbox.retry(id);
  }
}
