import { IsArray, IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

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
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'GRADUATED', 'LEFT']) status?: 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'LEFT';
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() avatarUrl?: string;
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
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'GRADUATED', 'LEFT']) status?: 'ACTIVE' | 'PAUSED' | 'GRADUATED' | 'LEFT';
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() avatarUrl?: string;
}

export class LinkGuardianDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

