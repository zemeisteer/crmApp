import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';

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
  @IsString()
  @MaxLength(2000)
  refreshToken: string;
}
