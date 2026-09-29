import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateMockTestDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(120) subject?: string;
  // Start from the built-in sample test.
  @IsOptional() @IsBoolean() sample?: boolean;
  @IsOptional() @IsObject() content?: Record<string, unknown>;
  @IsOptional() @IsIn(['B4', 'B5', 'B6', 'B7', 'B8', null]) level?: string | null;
  @IsOptional() @IsIn(['ACADEMIC', 'GENERAL']) module?: string;
  // IELTS (default) or PRACTICE: timed sections for any direction.
  @IsOptional() @IsIn(['IELTS', 'PRACTICE']) kind?: string;
  // PRACTICE: starting layout (SAT, ENGLISH, MATH, PROGRAMMING, GENERAL).
  @IsOptional() @IsIn(['SAT', 'ENGLISH', 'MATH', 'PROGRAMMING', 'GENERAL']) template?: string;
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
  // IELTS writing/speaking, or a practice section ("s0", "s1"...).
  @IsString() @Matches(/^(writing|speaking|s\d)$/) section: string;
}

export class ReviewPracticeDto {
  @IsString() @Matches(/^s\d$/) section: string;
  // Points per writing task, 0-10.
  @IsArray() @ArrayMaxSize(4) @IsNumber({}, { each: true }) @Min(0, { each: true }) @Max(10, { each: true }) scores: number[];
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
}

export class GeneratePracticeDto {
  @IsString() @MaxLength(120) subject: string;
  @IsOptional() @IsString() @MaxLength(200) topic?: string;
  @IsOptional() @IsInt() @Min(5) @Max(20) count?: number;
}

export class GenerateMockQuestionsDto {
  @IsString() @MaxLength(120) subject: string;
  @IsOptional() @IsString() @MaxLength(300) topic?: string;
  @IsOptional() @IsInt() @Min(1) @Max(30) count?: number;
  @IsOptional() @IsString() @MaxLength(1000) request?: string;
}
