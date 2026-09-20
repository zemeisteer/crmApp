import { Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto, RefreshTokenDto, ResetPasswordDto } from './dto/forgot-password.dto';
import { ConfirmTwoFactorDto, VerifyTwoFactorDto } from './dto/two-factor.dto';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';

function meta(req: Request, userAgent?: string) {
  return { userAgent, ip: req.ip };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request, @Headers('user-agent') ua?: string) {
    return this.authService.login(dto, meta(req, ua));
  }

  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  @Post('2fa/verify-login')
  verifyTwoFactorLogin(@Body() dto: VerifyTwoFactorDto, @Req() req: Request, @Headers('user-agent') ua?: string) {
    return this.authService.verifyTwoFactorLogin(dto.pendingToken, dto.code, meta(req, ua));
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser('sub') userId: string) {
    return this.authService.setupTwoFactor(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/confirm')
  confirmTwoFactor(@CurrentUser('sub') userId: string, @Body() dto: ConfirmTwoFactorDto) {
    return this.authService.confirmTwoFactor(userId, dto.code);
  }

  @UseGuards(JwtAuthGuard)
  @Post('2fa/disable')
  disableTwoFactor(@CurrentUser('sub') userId: string, @Body() dto: ConfirmTwoFactorDto) {
    return this.authService.disableTwoFactor(userId, dto.code);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto, @Req() req: Request, @Headers('user-agent') ua?: string) {
    return this.authService.refresh(dto.refreshToken, meta(req, ua));
  }

  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  listSessions(@CurrentUser('sub') userId: string) {
    return this.authService.listSessions(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions/:id')
  revokeSession(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.authService.revokeSession(userId, id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Get('verify-email')
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }
}
