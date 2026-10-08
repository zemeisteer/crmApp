import { Global, Module } from '@nestjs/common';
import { CalendarChanges } from './calendar-changes';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Global()
@Module({
  controllers: [LessonsController],
  providers: [LessonsService, CalendarChanges],
  exports: [LessonsService, CalendarChanges],
})
export class LessonsModule {}
