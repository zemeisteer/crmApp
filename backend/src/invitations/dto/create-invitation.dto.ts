import { IsEnum, IsOptional, IsString, IsEmail, MaxLength } from 'class-validator';

export class CreateInvitationDto {
  @IsEnum(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'ACCOUNTANT', 'TEACHER', 'STUDENT', 'PARENT'])
  role: 'ADMIN' | 'MANAGER' | 'RECEPTIONIST' | 'ACCOUNTANT' | 'TEACHER' | 'STUDENT' | 'PARENT';

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  phone?: string;
}
