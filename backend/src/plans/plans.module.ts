import { Module, OnModuleInit } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { TranslateService } from './translate.service';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [AiModule],
  providers: [PlansService, TranslateService],
  controllers: [PlansController],
  exports: [PlansService, TranslateService],
})
export class PlansModule implements OnModuleInit {
  constructor(private readonly service: PlansService) {}

  async onModuleInit() {
    await this.service.ensureSeeded();
  }
}
