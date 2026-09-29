import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalAuthGuard } from './portal-auth.guard';
import { BillingModule } from '../billing/billing.module';
import { ExamsModule } from '../exams/exams.module';
import { AiModule } from '../ai/ai.module';
import { PortalTutorController } from './portal-tutor.controller';
import { PortalMockController } from './portal-mock.controller';
import { MockTestsModule } from '../mock-tests/mock-tests.module';

@Module({
  imports: [
    BillingModule,
    ExamsModule,
    AiModule,
    MockTestsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '30d',
        },
      }),
    }),
  ],
  providers: [PortalService, PortalAuthGuard],
  controllers: [PortalController, PortalTutorController, PortalMockController],
  exports: [PortalService],
})
export class PortalModule {}
