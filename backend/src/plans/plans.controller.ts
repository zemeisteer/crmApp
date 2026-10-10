import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { PlansService } from './plans.service';
import { CreatePlanDto, TranslateFeaturesDto, UpdatePlanDto } from './dto/plan.dto';
import { MAX_LINES, MAX_LINE_LENGTH, TranslateService } from './translate.service';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly service: PlansService,
    private readonly translate: TranslateService,
  ) {}

  // Public — the landing site's pricing section, and the register form's
  // plan preview, read this without auth.
  @Get('public')
  listActive() {
    return this.service.listActive();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Get()
  listAll() {
    return this.service.listAll();
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Post()
  create(@Body() dto: CreatePlanDto) {
    return this.service.create(dto);
  }

  // The Uzbek feature list in Russian and English, for the form to fill
  // in (the admin still reads and saves it).
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Post('translate')
  async translateFeatures(@Body() dto: TranslateFeaturesDto) {
    const lines = dto.features.split(/\r?\n/).map((l) => l.trim().slice(0, MAX_LINE_LENGTH)).filter(Boolean).slice(0, MAX_LINES);
    const [ru, en] = await Promise.all([this.translate.translateLines(lines, 'RU'), this.translate.translateLines(lines, 'EN')]);
    return { featuresRu: ru.lines.join('\n'), featuresEn: en.lines.join('\n'), provider: ru.provider };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
