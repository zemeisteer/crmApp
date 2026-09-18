import { IsOptional, IsString } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  fullName: string;

  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() parentPhone?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() telegramUsername?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() groupId?: string;
}

export class UpdateStudentDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() parentPhone?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() telegramUsername?: string;
  @IsOptional() @IsString() startDate?: string;
}
