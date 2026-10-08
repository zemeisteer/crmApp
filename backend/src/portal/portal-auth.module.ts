import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PortalAuthGuard } from './portal-auth.guard';

// The cabinet (student / parent) guard for modules outside the portal that
// serve cabinet routes (files, chat, calendar).
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  providers: [PortalAuthGuard],
  exports: [PortalAuthGuard, JwtModule],
})
export class PortalAuthModule {}
