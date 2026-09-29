import { IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateMockTestDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(120) subject?: string;
  // Start from the built-in sample test.
  @IsOptional() @IsBoolean() sample?: boolean;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
  @IsOptional() @IsIn(['B4', 'B5', 'B6', 'B7', 'B8', null]) level?: string | null;
  @IsOptional() @IsIn(['ACADEMIC', 'GENERAL']) module?: string;
}

export class UpdateMockTestDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(120) subject?: string;
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED']) status?: string;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
  // null clears the level (open to every level).
  @IsOptional() @IsIn(['B4', 'B5', 'B6', 'B7', 'B8', null]) level?: string | null;
  @IsOptional() @IsIn(['ACADEMIC', 'GENERAL']) module?: string;
}

export class ReviewMockAttemptDto {
  @IsIn(['writing', 'speaking']) section: 'writing' | 'speaking';
  @IsNumber() @Min(0) @Max(9) band: number;
  @IsOptional() @IsNumber() @Min(0) @Max(9) task1?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(9) task2?: number;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class RegradeMockAttemptDto {
  @IsIn(['writing', 'speaking']) section: 'writing' | 'speaking';
}
