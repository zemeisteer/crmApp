import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn(['ADMIN', 'TEACHER', 'ACCOUNTANT'])
  role: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(['ADMIN', 'TEACHER', 'ACCOUNTANT'])
  role?: string;
}
