import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq } from 'drizzle-orm';
import { DB, Database } from '../db/db.module';
import { students } from '../db/schema';
import { StudentTutorService, TUTOR_MAX_QUESTION } from '../ai/student-tutor.service';
import { PortalAuthGuard } from './portal-auth.guard';
import { PortalUser, PortalUserPayload } from './portal-user.decorator';

// The AI tutor in the student's web cabinet — the same conversation and
// daily limit as the Telegram bot.
@Controller('portal/ai')
@UseGuards(PortalAuthGuard)
export class PortalTutorController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tutor: StudentTutorService,
  ) {}

  private async student(user: PortalUserPayload) {
    // The conversation and the daily limit are the student's own.
    if (user.viewer === 'parent') throw new ForbiddenException("AI ustoz o'quvchining o'zi uchun");
    const s = await this.db.query.students.findFirst({
      where: and(eq(students.id, user.studentId), eq(students.tenantId, user.tenantId)),
      columns: { id: true, tenantId: true, fullName: true },
      with: { tenant: { columns: { name: true, studentAiDailyLimit: true, timezone: true } } },
    });
    if (!s) throw new NotFoundException("O'quvchi topilmadi");
    return s;
  }

  @Get()
  async state(@PortalUser() user: PortalUserPayload) {
    const s = await this.student(user);
    const quota = await this.tutor.quota(s);
    return {
      enabled: quota.limit > 0,
      available: this.tutor.available,
      limit: quota.limit,
      left: quota.left,
      messages: await this.tutor.conversation(s.id),
    };
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ask')
  async ask(@PortalUser() user: PortalUserPayload, @Body('message') message: unknown) {
    const text = typeof message === 'string' ? message.trim() : '';
    if (!text) throw new BadRequestException('Savol yozilmagan');
    if (text.length > TUTOR_MAX_QUESTION) throw new BadRequestException(`Savol ${TUTOR_MAX_QUESTION} belgidan oshmasin`);
    return this.tutor.ask(await this.student(user), text);
  }

  @Post('reset')
  async reset(@PortalUser() user: PortalUserPayload) {
    await this.tutor.reset(await this.student(user));
    return { ok: true };
  }
}
