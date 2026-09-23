import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import {
  BulkCreateSubjectsDto,
  CreateCourseDto,
  CreateSubjectDto,
  UpdateCourseDto,
  UpdateSubjectDto,
} from './dto/subject.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @Get()
  findAll(@CurrentUser('tenantId') tenantId: string) {
    return this.subjectsService.findAll(tenantId);
  }

  @Post()
  create(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateSubjectDto) {
    return this.subjectsService.create(tenantId, dto);
  }

  @Post('bulk')
  bulkCreate(@CurrentUser('tenantId') tenantId: string, @Body() dto: BulkCreateSubjectsDto) {
    return this.subjectsService.bulkCreate(tenantId, dto);
  }

  @Get('courses')
  findAllCourses(
    @CurrentUser('tenantId') tenantId: string,
    @Query('subjectId') subjectId?: string,
  ) {
    return this.subjectsService.findAllCourses(tenantId, subjectId);
  }

  @Post('courses')
  createCourse(@CurrentUser('tenantId') tenantId: string, @Body() dto: CreateCourseDto) {
    return this.subjectsService.createCourse(tenantId, dto);
  }

  @Put('courses/:id')
  updateCourse(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
  ) {
    return this.subjectsService.updateCourse(tenantId, id, dto);
  }

  @Delete('courses/:id')
  removeCourse(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.subjectsService.removeCourse(tenantId, id);
  }

  @Get(':id')
  findOne(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.subjectsService.findOne(tenantId, id);
  }

  @Put(':id')
  update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.subjectsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('tenantId') tenantId: string, @Param('id') id: string) {
    return this.subjectsService.remove(tenantId, id);
  }
}
