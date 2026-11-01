import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @MinLength(6)
  password?: string;
}
