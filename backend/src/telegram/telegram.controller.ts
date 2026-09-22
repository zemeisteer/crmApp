import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  constructor(private readonly service: TelegramService) {}

  // Called by Telegram itself (set via setWebhook) — no auth, Telegram
  // doesn't send our JWT. Keep this endpoint fast and side-effect-safe.
  @Post('webhook')
  webhook(@Body() update: any) {
    return this.service.handleUpdate(update).then(() => ({ ok: true }));
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  @Get('status')
  status() {
    return { configured: this.service.isConfigured, botUsername: this.service.botUsername };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'TEACHER')
  @Post('link-token')
  generateLinkToken(
    @CurrentUser('tenantId') tenantId: string,
    @Body('studentId') studentId: string,
  ) {
    return this.service.generateLinkToken(tenantId, studentId);
  }
}
