import { Module } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { SalaryController } from './salary.controller';
import { TeacherAttendanceModule } from '../teacher-attendance/teacher-attendance.module';

@Module({
  imports: [TeacherAttendanceModule],
  providers: [SalaryService],
  controllers: [SalaryController],
})
export class SalaryModule {}
