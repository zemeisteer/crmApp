import { Body, Controller, Delete, ForbiddenException, Get, Headers, Logger, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { TelegramService } from './telegram.service';

@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);
  private readonly inFlight = new Set<Promise<unknown>>();

  // Resolves when every update received so far has been handled.
  async idle() {
    await Promise.all(this.inFlight);
  }

  constructor(private readonly service: TelegramService) {}

  // Called by Telegram itself (set via setWebhook) — no auth, Telegram
  // doesn't send our JWT. Keep this endpoint fast and side-effect-safe.
  @Post('webhook')
  webhook(@Body() update: any, @Headers('x-telegram-bot-api-secret-token') secret?: string) {
    if (!this.service.isValidWebhookSecret(secret)) throw new UnauthorizedException();
    // Answer Telegram at once: a slow reply (the AI tutor) would otherwise
    // time out and Telegram would deliver the same message again.
    const job = this.service
      .handleUpdate(update)
      .catch((err) => this.logger.error(`Telegram update failed: ${(err as Error).message}`))
      .finally(() => this.inFlight.delete(job));
    this.inFlight.add(job);
    return { ok: true };
  }

  // ---- The signed-in staff member's own Telegram (CRM reminders) ----
  // No @Roles: RolesGuard keeps these staff-only (students/parents use the
  // portal bot flow instead).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Get('me')
  myStatus(@CurrentUser('sub') userId: string) {
    return this.service.staffStatus(userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Post('me/link')
  myLink(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string) {
    if (!tenantId) throw new ForbiddenException('Tashkilot tanlanmagan');
    return this.service.generateStaffLinkToken(tenantId, userId);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Delete('me')
  myUnlink(@CurrentUser('sub') userId: string) {
    return this.service.unlinkStaff(userId);
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
    @Body('purpose') purpose?: string,
  ) {
    // 'PARENT' adds a parent's chat; anything else links the student's own.
    return this.service.generateLinkToken(tenantId, studentId, purpose === 'PARENT' ? 'PARENT' : 'STUDENT');
  }
}
