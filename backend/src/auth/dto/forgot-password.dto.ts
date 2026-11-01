import { IsOptional, IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(2000)
  token: string;

  @IsString()
  @MaxLength(2000)
  @MinLength(6)
  password: string;
}

export class RefreshTokenDto {
  // The site sends it as a cookie (common/session-cookie.ts).
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  refreshToken?: string;
}
