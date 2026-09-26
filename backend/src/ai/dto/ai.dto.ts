import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

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

