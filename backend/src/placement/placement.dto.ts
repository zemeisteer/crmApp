import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreatePlacementTestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  subject!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED'])
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(40)
  count?: number;

  @IsOptional()
  @IsIn(['UZ', 'RU', 'EN'])
  language?: 'UZ' | 'RU' | 'EN';

  // Ready questions (e.g. reviewed after a PDF import) instead of generating.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(300)
  questions?: unknown[];
}

// Close/reopen the link, or rename the test.
export class SetPlacementActiveDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;
}

export class GradePlacementDto {
  @IsObject()
  scores!: Record<string, number>;
}

export class SubmitPlacementDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  // One entry per question, by position: option index for choice
  // questions, the typed text for short answers ('' when skipped).
  @IsArray()
  @ArrayMaxSize(300)
  @IsString({ each: true })
  @MaxLength(5000, { each: true })
  answers!: string[];
}
