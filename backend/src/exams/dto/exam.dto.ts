import { ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { QUESTION_TYPES } from '../../common/test-questions';
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

// Shape of one question (validated in depth by normalizeQuestion).
export class CreateExamQuestionDto {
  @IsString()
  @IsNotEmpty()
  prompt: string;

  @IsOptional()
  @IsIn(QUESTION_TYPES as unknown as string[])
  questionType?: string;

  @IsOptional()
  @IsIn(QUESTION_TYPES as unknown as string[])
  type?: string;

  @IsOptional()
  options?: any;

  @IsOptional()
  @IsString()
  correctAnswer?: string;

  @IsOptional() @IsString() @MaxLength(300) section?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) instruction?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) passage?: string | null;
  @IsOptional() @IsArray() pairs?: Array<{ left: string; right: string }>;
  @IsOptional() @IsArray() words?: string[];
  @IsOptional() @IsString() @MaxLength(4000) rubric?: string | null;

  @IsOptional()
  @IsString()
  explanation?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  points?: number;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class GradeAttemptDto {
  @IsObject()
  scores: Record<string, number>;
}

export class GenerateQuestionsDto {
  @IsOptional() @IsInt() @Min(1) @Max(40) count?: number;
  @IsOptional() @IsString() @MaxLength(1000) request?: string;
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
