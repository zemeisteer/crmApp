import { Module } from '@nestjs/common';
import { ScheduleModule } from '../schedule/schedule.module';
import { GroupsService } from './groups.service';
import { GroupsController } from './groups.controller';

@Module({
  imports: [ScheduleModule],
  providers: [GroupsService],
  exports: [GroupsService],
  controllers: [GroupsController],
})
export class GroupsModule {}
