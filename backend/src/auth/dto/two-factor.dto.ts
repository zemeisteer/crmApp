import { IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyTwoFactorDto {
  @IsString()
  pendingToken: string;

  @IsString()
  code: string;
}

export class ConfirmTwoFactorDto {
  @IsString()
  code: string;
}

/**
 * Setting up a key when 2FA is already on, or turning it off: the password
 * and the current factor (a 6-digit code or a recovery code).
 */
export class TwoFactorReauthDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  code?: string;
}
