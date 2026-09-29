import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MockTestsService } from './mock-tests.service';
import { MockTestsController } from './mock-tests.controller';

@Module({
  imports: [AiModule],
  providers: [MockTestsService],
  controllers: [MockTestsController],
  exports: [MockTestsService],
})
export class MockTestsModule {}
