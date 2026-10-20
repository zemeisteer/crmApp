import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { SignupPhoneService } from './signup-phone.service';
import { EskizProvider } from '../notifications/sms/eskiz.provider';
import { PlayMobileProvider } from '../notifications/sms/playmobile.provider';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '7d') as any,
        },
      }),
    }),
  ],
  providers: [AuthService, SignupPhoneService, EskizProvider, PlayMobileProvider],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
