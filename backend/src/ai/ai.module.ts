import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { StudentTutorService } from './student-tutor.service';

@Module({
  providers: [AiService, StudentTutorService],
  controllers: [AiController],
  exports: [AiService, StudentTutorService],
})
export class AiModule {}
