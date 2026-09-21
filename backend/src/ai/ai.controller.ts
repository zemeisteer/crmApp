import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AiService } from './ai.service';
import { GenerateMaterialDto, GroupInsightsDto, SuggestHomeworkDto } from './dto/ai.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  @Post('insights')
  insights(@CurrentUser('tenantId') tenantId: string, @Body() dto: GroupInsightsDto) {
    return this.service.groupInsights(tenantId, dto.groupId);
  }

  @Post('materials')
  materials(@Body() dto: GenerateMaterialDto) {
    return this.service.generateMaterial(dto);
  }

  @Post('suggest-homework')
  suggestHomework(@Body() dto: SuggestHomeworkDto) {
    return this.service.suggestHomework(dto);
  }
}

