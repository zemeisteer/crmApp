import { Module } from '@nestjs/common';
import { TeacherAttendanceService } from './teacher-attendance.service';
import { TeacherAttendanceController } from './teacher-attendance.controller';

@Module({
  providers: [TeacherAttendanceService],
  controllers: [TeacherAttendanceController],
  exports: [TeacherAttendanceService],
})
export class TeacherAttendanceModule {}
