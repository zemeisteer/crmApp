import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export const LEFT_REASONS = ['PRICE', 'SCHEDULE', 'MOVED', 'RESULTS', 'TEACHER', 'GOAL_REACHED', 'OTHER'] as const;

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
  // The center's own fields: definition id -> value (custom-fields).
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
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
  // Why the student left (status LEFT); see LEFT_REASONS.
  @IsOptional() @IsIn(LEFT_REASONS) leftReason?: (typeof LEFT_REASONS)[number];
  // Only the fields sent change; null clears one.
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

export class LinkGuardianDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() relationship?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}

