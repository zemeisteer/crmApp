import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { TrialFeedbackDto } from './dto/lead.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { LeadTrialsService } from './lead-trials.service';

// A teacher's own coming trial lessons (their groups, or booked with them by
// name): who comes and when, without the admissions data behind it.
@UseGuards(JwtAuthGuard)
@Controller('trials')
export class TrialsMineController {
  constructor(private readonly trials: LeadTrialsService) {}

  @Get('mine')
  mine(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string) {
    return this.trials.forTeacher(tenantId, userId);
  }

  // How the trial went, from its teacher (knowledge, participation, which
  // group fits): the admissions manager reads it on the lead.
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('mine/:trialId/feedback')
  feedback(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('trialId') trialId: string, @Body() dto: TrialFeedbackDto) {
    return this.trials.teacherFeedback(tenantId, userId, trialId, dto);
  }
}
