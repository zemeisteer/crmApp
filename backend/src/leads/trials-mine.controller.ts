import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
