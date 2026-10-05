import { Module } from '@nestjs/common';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';

@Module({
  providers: [StudentsService],
  exports: [StudentsService],
  controllers: [StudentsController],
})
export class StudentsModule {}
