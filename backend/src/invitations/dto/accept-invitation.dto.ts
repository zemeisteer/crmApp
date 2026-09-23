import { IsOptional, IsString, MinLength } from 'class-validator';

export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
