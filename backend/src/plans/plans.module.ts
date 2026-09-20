import { Module, OnModuleInit } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';

@Module({
  providers: [PlansService],
  controllers: [PlansController],
  exports: [PlansService],
})
export class PlansModule implements OnModuleInit {
  constructor(private readonly service: PlansService) {}

  async onModuleInit() {
    await this.service.ensureSeeded();
  }
}
