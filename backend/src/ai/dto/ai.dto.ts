import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GroupInsightsDto {
  @IsString()
  groupId: string;
}

export class GenerateMaterialDto {
  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsString()
  topic: string;

  @IsIn(['LESSON_PLAN', 'HOMEWORK', 'QUIZ'])
  type: string;

  @IsOptional()
  @IsString()
  customInstructions?: string;
}

export class SuggestHomeworkDto {
  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  groupName?: string;

  @IsOptional()
  @IsString()
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
