import { Module } from '@nestjs/common';
import { CenterEventsController } from './center-events.controller';
import { CenterEventsService } from './center-events.service';
import { ScheduleModule } from '../schedule/schedule.module';
import { LessonsModule } from '../lessons/lessons.module';

@Module({
  imports: [ScheduleModule, LessonsModule],
  controllers: [CenterEventsController],
  providers: [CenterEventsService],
})
export class CenterEventsModule {}
