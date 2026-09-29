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

@Module({
  imports: [
    BillingModule,
    ExamsModule,
    AiModule,
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
  controllers: [PortalController, PortalTutorController],
  exports: [PortalService],
})
export class PortalModule {}
