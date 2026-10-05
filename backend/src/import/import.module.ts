import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { StudentsModule } from '../students/students.module';
import { TeachersModule } from '../teachers/teachers.module';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';

@Module({
  imports: [TeachersModule, GroupsModule, StudentsModule],
  providers: [ImportService],
  controllers: [ImportController],
})
export class ImportModule {}
