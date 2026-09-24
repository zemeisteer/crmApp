import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { JwtPayload } from '../common/jwt.strategy';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { getEffectivePermissions, Permission } from '../common/permissions';
import { TrialGuard } from '../common/trial.guard';
import {
  ArchiveLeadDto,
  AssignLeadDto,
  BookTrialDto,
  ConvertLeadDto,
  CreateActivityDto,
  CreateLeadDto,
  FollowUpDto,
  FunnelQueryDto,
  LoseLeadDto,
  QueryLeadDto,
  ReopenLeadDto,
  RescheduleTrialDto,
  TransitionLeadDto,
  TrialOutcomeDto,
  UpdateLeadDto,
} from './dto/lead.dto';
import { Actor, LeadsService } from './leads.service';
import { LeadTrialsService } from './lead-trials.service';
import { LeadConversionService } from './lead-conversion.service';

// Admissions & Sales CRM API. Authorization is permission-based
// (admissions.*) and the tenant always comes from the verified token —
// never from the request body or query.
@Controller('leads')
@UseGuards(JwtAuthGuard, PermissionsGuard, TrialGuard)
export class LeadsController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly trials: LeadTrialsService,
    private readonly conversion: LeadConversionService,
  ) {}

  private ctx(user: JwtPayload): { tenantId: string; actor: Actor } {
    // Platform superadmins carry no tenant; admissions data is tenant-owned.
    if (!user?.tenantId) throw new ForbiddenException('Tashkilot tanlanmagan');
    return {
      tenantId: user.tenantId,
      actor: { userId: user.sub, permissions: getEffectivePermissions(user.role, user.permissions) },
    };
  }

  // ---------- collection routes (before :id) ----------

  @Get()
  @RequirePermissions(Permission.ADMISSIONS_READ)
  findAll(@CurrentUser() user: JwtPayload, @Query() query: QueryLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.findAll(tenantId, actor.userId, query);
  }

  @Get('funnel')
  @RequirePermissions(Permission.ADMISSIONS_ANALYTICS)
  getFunnelStats(@CurrentUser() user: JwtPayload) {
    return this.leadsService.getFunnelStats(this.ctx(user).tenantId);
  }

  @Get('analytics')
  @RequirePermissions(Permission.ADMISSIONS_ANALYTICS)
  analytics(@CurrentUser() user: JwtPayload, @Query() query: FunnelQueryDto) {
    return this.leadsService.getAnalytics(this.ctx(user).tenantId, query);
  }

  @Get('follow-ups/summary')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  followUps(@CurrentUser() user: JwtPayload, @Query('mine') mine?: string) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.followUpSummary(tenantId, actor.userId, mine === 'true');
  }

  @Get('duplicates')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  duplicates(@CurrentUser() user: JwtPayload, @Query('phone') phone?: string, @Query('email') email?: string) {
    return this.leadsService.checkDuplicates(this.ctx(user).tenantId, phone, email);
  }

  @Get('assignable-managers')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  assignableManagers(@CurrentUser() user: JwtPayload) {
    return this.leadsService.listAssignableManagers(this.ctx(user).tenantId);
  }

  @Get('trials')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  listTrials(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('teacherId') teacherId?: string,
    @Query('status') status?: string,
  ) {
    return this.trials.list(this.ctx(user).tenantId, { from, to, teacherId, status });
  }

  @Get('export')
  @RequirePermissions(Permission.ADMISSIONS_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="leads.csv"')
  exportCsv(@CurrentUser() user: JwtPayload, @Query() query: QueryLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.exportCsv(tenantId, actor, query);
  }

  @Post()
  @RequirePermissions(Permission.ADMISSIONS_CREATE)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.create(tenantId, actor, dto);
  }

  // ---------- single lead ----------

  @Get(':id')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.leadsService.findOne(this.ctx(user).tenantId, id);
  }

  @Get(':id/timeline')
  @RequirePermissions(Permission.ADMISSIONS_READ)
  timeline(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.leadsService.timeline(this.ctx(user).tenantId, id);
  }

  @Get(':id/student-match')
  @RequirePermissions(Permission.ADMISSIONS_CONVERT)
  studentMatch(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.conversion.previewStudentMatch(this.ctx(user).tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.update(tenantId, actor, id, dto);
  }

  @Post(':id/transition')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  transition(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: TransitionLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.transition(tenantId, actor, id, dto.toStatus, dto.note);
  }

  @Post(':id/lose')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  lose(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: LoseLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.lose(tenantId, actor, id, dto);
  }

  @Post(':id/reopen')
  @RequirePermissions(Permission.ADMISSIONS_MANAGE)
  reopen(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReopenLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.reopen(tenantId, actor, id, dto.note);
  }

  @Post(':id/assign')
  @RequirePermissions(Permission.ADMISSIONS_ASSIGN)
  assign(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: AssignLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.assign(tenantId, actor, id, dto);
  }

  @Post(':id/follow-up')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  followUp(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: FollowUpDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.setFollowUp(tenantId, actor, id, dto);
  }

  @Post(':id/activities')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  addActivity(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CreateActivityDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.addActivity(tenantId, actor, id, dto);
  }

  @Post(':id/trials/check')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  checkTrial(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: BookTrialDto) {
    return this.trials.check(this.ctx(user).tenantId, id, dto);
  }

  @Post(':id/trials')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  bookTrial(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: BookTrialDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.trials.book(tenantId, actor, id, dto);
  }

  @Post(':id/trials/:trialId/reschedule')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  reschedule(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('trialId') trialId: string,
    @Body() dto: RescheduleTrialDto,
  ) {
    const { tenantId, actor } = this.ctx(user);
    return this.trials.reschedule(tenantId, actor, id, trialId, dto);
  }

  @Post(':id/trials/:trialId/attend')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  attend(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('trialId') trialId: string, @Body() dto: TrialOutcomeDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.trials.attend(tenantId, actor, id, trialId, dto.note);
  }

  @Post(':id/trials/:trialId/miss')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  miss(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('trialId') trialId: string, @Body() dto: TrialOutcomeDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.trials.close(tenantId, actor, id, trialId, 'MISSED', dto.note);
  }

  @Post(':id/trials/:trialId/cancel')
  @RequirePermissions(Permission.ADMISSIONS_UPDATE)
  cancelTrial(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Param('trialId') trialId: string, @Body() dto: TrialOutcomeDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.trials.close(tenantId, actor, id, trialId, 'CANCELLED', dto.note);
  }

  @Post(':id/convert')
  @RequirePermissions(Permission.ADMISSIONS_CONVERT)
  convert(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ConvertLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.conversion.convert(tenantId, actor, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions(Permission.ADMISSIONS_MANAGE)
  archive(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ArchiveLeadDto) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.archive(tenantId, actor, id, dto.reason);
  }

  @Post(':id/restore')
  @RequirePermissions(Permission.ADMISSIONS_MANAGE)
  restore(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.restore(tenantId, actor, id);
  }

  // Kept for existing clients; it archives (soft-deletes) rather than
  // destroying the lead and its history.
  @Delete(':id')
  @RequirePermissions(Permission.ADMISSIONS_MANAGE)
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    const { tenantId, actor } = this.ctx(user);
    return this.leadsService.archive(tenantId, actor, id);
  }
}
