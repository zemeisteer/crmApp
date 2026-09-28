import { IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

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
  @IsOptional() @IsInt() salaryValue?: number;
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
  @IsOptional() @IsInt() salaryValue?: number;
}

// Login for a teacher: email + first password (they can change it later).
export class TeacherAccountDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}
