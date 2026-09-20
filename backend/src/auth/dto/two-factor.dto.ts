import { IsString } from 'class-validator';

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
