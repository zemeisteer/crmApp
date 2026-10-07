import { IsEmail, IsInt, IsOptional, IsString, MinLength, Max } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class CreateTeacherDto {
  @IsString()
  fullName: string;

  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() salaryType?: string;
  @IsOptional() @IsInt() @Max(MAX_MONEY) salaryValue?: number;
}

export class UpdateTeacherDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() salaryType?: string;
  @IsOptional() @IsInt() @Max(MAX_MONEY) salaryValue?: number;
}

// Login for a teacher: email + first password (they can change it later).
export class TeacherAccountDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
