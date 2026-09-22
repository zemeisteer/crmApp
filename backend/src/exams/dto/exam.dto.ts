import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
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

export class CreateExamQuestionDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsOptional()
  @IsIn(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'])
  questionType?: 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER';

  @IsOptional()
  options?: any; // array or JSON string: [{ id: "A", text: "..." }, ...]

  @IsString()
  @IsNotEmpty()
  correctAnswer: string;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  points?: number;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class BatchCreateQuestionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateExamQuestionDto)
  questions: CreateExamQuestionDto[];
}

export class SubmitAttemptDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsObject()
  answers: Record<string, string>; // { [questionId]: "A" }
}
