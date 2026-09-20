import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateStudentDto {
  @IsString()
  fullName: string;

  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() parentPhone?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() telegramUsername?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) groupIds?: string[];
}

export class UpdateStudentDto {
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() parentPhone?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() telegramUsername?: string;
  @IsOptional() @IsString() startDate?: string;
}
