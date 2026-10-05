import { Module } from '@nestjs/common';
import { StaffModule } from '../staff/staff.module';
import { TeachersService } from './teachers.service';
import { TeachersController } from './teachers.controller';

@Module({
  imports: [StaffModule],
  providers: [TeachersService],
  exports: [TeachersService],
  controllers: [TeachersController],
})
export class TeachersModule {}
