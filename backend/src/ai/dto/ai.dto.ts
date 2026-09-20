import { IsIn, IsOptional, IsString } from 'class-validator';

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
}
