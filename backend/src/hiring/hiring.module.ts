import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TeachersModule } from '../teachers/teachers.module';
import { HiringController } from './hiring.controller';
import { HiringService } from './hiring.service';

@Module({
  imports: [AuditModule, TeachersModule],
  providers: [HiringService],
  controllers: [HiringController],
  exports: [HiringService],
})
export class HiringModule {}
