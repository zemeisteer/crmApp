import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { TrialGuard } from '../common/trial.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { StudentsService } from './students.service';
import { CreateStudentDto, LinkGuardianDto, UpdateStudentDto } from './dto/student.dto';

@UseGuards(JwtAuthGuard, RolesGuard, TrialGuard)
@Controller('students')
export class StudentsController {
  constructor(private readonly service: StudentsService) {}

  @Get()
  findAll(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.service.findAll(tenantId, { status, branchId }, { role, userId });
  }

  @Roles('ADMIN')
  @Get('trash')
  trash(@CurrentUser('tenantId') tenantId: string) {
    return this.service.trash(tenantId);
  }

  @Get(':id')
  findOne(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(tenantId, id, { role, userId });
  }

  @Roles('ADMIN')
  @Post()
  create(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateStudentDto,
  ) {
    return this.service.create(tenantId, userId, dto);
  }

  @Roles('ADMIN')
  @Patch(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.service.update(tenantId, userId, id, dto);
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

  @Roles('ADMIN')
  @Post(':id/enroll/:groupId')
  enroll(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
  ) {
    return this.service.enroll(tenantId, id, groupId);
  }

  @Roles('ADMIN')
  @Delete(':id/enroll/:groupId')
  unenroll(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('groupId') groupId: string,
  ) {
    return this.service.unenroll(tenantId, id, groupId);
  }

  @Get(':id/guardians')
  getGuardians(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('role') role: string,
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.service.getGuardians(tenantId, id, { role, userId });
  }

  @Roles('ADMIN')
  @Post(':id/guardians')
  linkGuardian(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: LinkGuardianDto,
  ) {
    return this.service.linkGuardian(tenantId, id, dto);
  }

  @Roles('ADMIN')
  @Delete(':id/guardians/:guardianId')
  unlinkGuardian(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Param('guardianId') guardianId: string,
  ) {
    return this.service.unlinkGuardian(tenantId, id, guardianId);
  }
}
