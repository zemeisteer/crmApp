import { Module } from '@nestjs/common';
import { CenterEventsController } from './center-events.controller';
import { CenterEventsService } from './center-events.service';

@Module({
  controllers: [CenterEventsController],
  providers: [CenterEventsService],
})
export class CenterEventsModule {}
