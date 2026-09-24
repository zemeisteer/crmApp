import { IsInt, IsOptional, IsString } from 'class-validator';

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
