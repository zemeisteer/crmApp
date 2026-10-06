import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Headers,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { JwtPayload } from '../common/jwt.strategy';
import { TeachersService } from './teachers.service';
import { CreateTeacherDto, UpdateTeacherDto , TeacherAccountDto } from './dto/teacher.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('teachers')
export class TeachersController {
  constructor(private readonly service: TeachersService) {}

  // Any staff member may list teachers; pay only reaches those who may see it.
  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.service.findAll(tenantId, user);
  }

  @Roles('ADMIN')
  @Get('trash')
  trash(@CurrentUser('tenantId') tenantId: string, @CurrentUser() user: JwtPayload) {
    return this.service.trash(tenantId, user);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.service.view(tenantId, id, user);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateTeacherDto,
    // Optional: a form sends one per submission so that a retry (double
    // click, lost reply) returns the first result. See common/create-idempotency.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.service.create(tenantId, userId, dto, idempotencyKey);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTeacherDto,
  ) {
    return this.service.update(tenantId, userId, id, dto);
  }

  // Login for the teacher (email + password), and taking it away.
  @Roles('ADMIN')
  @Post(':id/account')
  createAccount(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: TeacherAccountDto,
  ) {
    return this.service.createAccount(tenantId, userId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id/account')
  removeAccount(@CurrentUser('tenantId') tenantId: string, @CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.service.removeAccount(tenantId, userId, id);
  }

  @Roles('ADMIN')
  @Delete(':id')
  remove(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.remove(tenantId, userId, id);
  }

  @Roles('ADMIN')
  @Post(':id/restore')
  restore(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.restore(tenantId, userId, id);
  }
}
