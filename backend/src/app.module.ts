import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { AuthCommonModule } from './common/auth-common.module';
import { EmailModule } from './email/email.module';
import { AuditModule } from './audit/audit.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { TelegramModule } from './telegram/telegram.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { GroupsModule } from './groups/groups.module';
import { StudentsModule } from './students/students.module';
import { TeachersModule } from './teachers/teachers.module';
import { PaymentsModule } from './payments/payments.module';
import { AttendanceModule } from './attendance/attendance.module';
import { SalaryModule } from './salary/salary.module';
import { BillingModule } from './billing/billing.module';
import { AiModule } from './ai/ai.module';
import { HomeworkModule } from './homework/homework.module';
import { BranchesModule } from './branches/branches.module';
import { ExportModule } from './export/export.module';
import { PlatformBillingModule } from './platform-billing/platform-billing.module';
import { ExamsModule } from './exams/exams.module';
import { HealthModule } from './health/health.module';
import { PlansModule } from './plans/plans.module';
import { StaffModule } from './staff/staff.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    DbModule,
    AuthCommonModule,
    EmailModule,
    AuditModule,
    WebhooksModule,
    FeatureFlagsModule,
    TelegramModule,
    AuthModule,
    TenantsModule,
    GroupsModule,
    StudentsModule,
    TeachersModule,
    PaymentsModule,
    AttendanceModule,
    SalaryModule,
    BillingModule,
    AiModule,
    HomeworkModule,
    BranchesModule,
    ExportModule,
    PlatformBillingModule,
    ExamsModule,
    HealthModule,
    PlansModule,
    StaffModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
