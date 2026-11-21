import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// The signed-in person's own account (not a center's staff record).
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(2000)
  currentPassword: string;

  @IsString()
  @MinLength(6)
  @MaxLength(2000)
  newPassword: string;

  // Needed only when the account has 2FA on.
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
