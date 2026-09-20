import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateExamDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  groupIds: string[];

  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxScore?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  passingScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  examDate?: string;
}

export class ExamResultEntryDto {
  @IsString()
  studentId: string;

  @IsInt()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  note?: string;
}

export class SubmitResultsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ExamResultEntryDto)
  results: ExamResultEntryDto[];
}
