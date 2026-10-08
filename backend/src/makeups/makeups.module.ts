import { Module } from '@nestjs/common';
import { PortalAuthModule } from '../portal/portal-auth.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { MakeupsController } from './makeups.controller';
import { MakeupsService } from './makeups.service';

@Module({
  imports: [PortalAuthModule, ScheduleModule],
  controllers: [MakeupsController],
  providers: [MakeupsService],
  exports: [MakeupsService],
})
export class MakeupsModule {}
