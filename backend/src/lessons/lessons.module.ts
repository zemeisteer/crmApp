import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '../schedule/schedule.module';
import { CalendarChanges } from './calendar-changes';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Global()
@Module({
  imports: [ScheduleModule],
  controllers: [LessonsController],
  providers: [LessonsService, CalendarChanges],
  exports: [LessonsService, CalendarChanges],
})
export class LessonsModule {}
