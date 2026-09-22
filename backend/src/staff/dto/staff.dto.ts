import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsIn(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER', 'ACCOUNTANT'])
  role: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER', 'ACCOUNTANT'])
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}
