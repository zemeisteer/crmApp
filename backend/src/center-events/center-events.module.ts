import { Module } from '@nestjs/common';
import { CenterEventsController } from './center-events.controller';
import { CenterEventsService } from './center-events.service';
import { ScheduleModule } from '../schedule/schedule.module';

@Module({
  imports: [ScheduleModule],
  controllers: [CenterEventsController],
  providers: [CenterEventsService],
})
export class CenterEventsModule {}
