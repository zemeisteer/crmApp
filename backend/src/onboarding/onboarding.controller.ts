import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import {
  BranchStepDto,
  CategoriesStepDto,
  CheckSubdomainDto,
  ProfileStepDto,
  WorkspaceStepDto,
} from './dto/onboarding.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Get('state')
  getState(@CurrentUser('tenantId') tenantId: string) {
    return this.onboardingService.getState(tenantId);
  }

  @Post('check-subdomain')
  checkSubdomain(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CheckSubdomainDto,
  ) {
    return this.onboardingService.checkSubdomain(tenantId, dto.subdomain);
  }

  @Post('profile')
  updateProfile(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: ProfileStepDto,
  ) {
    return this.onboardingService.updateProfile(tenantId, dto);
  }

  @Post('categories')
  updateCategories(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CategoriesStepDto,
  ) {
    return this.onboardingService.updateCategories(tenantId, dto);
  }

  @Post('workspace')
  updateWorkspace(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: WorkspaceStepDto,
  ) {
    return this.onboardingService.updateWorkspace(tenantId, dto);
  }

  @Post('branch')
  addFirstBranch(
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: BranchStepDto,
  ) {
    return this.onboardingService.addFirstBranch(tenantId, dto);
  }

  @Post('advance/:step')
  advanceToStep(
    @CurrentUser('tenantId') tenantId: string,
    @Param('step') step: string,
  ) {
    return this.onboardingService.advanceToStep(tenantId, step);
  }

  @Post('skip/:step')
  skipStep(
    @CurrentUser('tenantId') tenantId: string,
    @Param('step') step: string,
  ) {
    return this.onboardingService.skipStep(tenantId, step);
  }

  @Post('complete')
  complete(@CurrentUser('tenantId') tenantId: string) {
    return this.onboardingService.complete(tenantId);
  }
}
