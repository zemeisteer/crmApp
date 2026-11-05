import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class GroupInsightsDto {
  @IsString()
  @MaxLength(2000)
  groupId: string;
}

export class TutorReportDto {
  @IsString()
  @MaxLength(2000)
  groupId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

export class GenerateMaterialDto {
  @IsString()
  @MaxLength(2000)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  level?: string;

  @IsString()
  @MaxLength(50000)
  topic: string;

  @IsIn(['LESSON_PLAN', 'HOMEWORK', 'QUIZ'])
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  customInstructions?: string;
}

export class SuggestHomeworkDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  level?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  groupName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  topic?: string;

  // What the teacher described they need, in their own words.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  request?: string;
}


export class PlacementTestDto {
  @IsString()
  @MaxLength(100)
  subject!: string;

  // Expected level the center wants to check around (optional).
  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  groupId?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(30)
  count?: number;

  @IsOptional()
  @IsIn(['UZ', 'RU', 'EN'])
  language?: 'UZ' | 'RU' | 'EN';
}

// Text to turn into a downloadable PDF (AI materials).
export class RenderPdfDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60000)
  content!: string;
}
