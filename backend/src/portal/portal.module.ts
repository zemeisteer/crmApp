import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';
import { PortalAuthGuard } from './portal-auth.guard';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [
    BillingModule,
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
  controllers: [PortalController],
  exports: [PortalService],
})
export class PortalModule {}
