import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MockTestsService } from './mock-tests.service';
import { MockTestsController } from './mock-tests.controller';
import { MockImportService } from './import/mock-import.service';

@Module({
  imports: [AiModule],
  providers: [MockTestsService, MockImportService],
  controllers: [MockTestsController],
  exports: [MockTestsService],
})
export class MockTestsModule {}
