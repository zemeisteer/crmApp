import { Module } from '@nestjs/common';
import { HomeworkService } from './homework.service';
import { HomeworkController } from './homework.controller';

@Module({
  providers: [HomeworkService],
  controllers: [HomeworkController],
})
export class HomeworkModule {}
