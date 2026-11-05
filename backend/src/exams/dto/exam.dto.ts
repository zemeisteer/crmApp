import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  MinLength,
} from 'class-validator';
import { QUESTION_TYPES } from '../../common/test-questions';
import { Type } from 'class-transformer';

export class CreateExamDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  groupIds: string[];

  @IsString()
  @MaxLength(2000)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
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
  @MaxLength(2000)
  examDate?: string;
}

export class ExamResultEntryDto {
  @IsString()
  @MaxLength(2000)
  studentId: string;

  @IsInt()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
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
  @MaxLength(50000)
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
  @MaxLength(50000)
  correctAnswer?: string;

  @IsOptional() @IsString() @MaxLength(300) section?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) instruction?: string | null;
  @IsOptional() @IsString() @MaxLength(20000) passage?: string | null;
  @IsOptional() @IsArray() pairs?: Array<{ left: string; right: string }>;
  @IsOptional() @IsArray() words?: string[];
  @IsOptional() @IsString() @MaxLength(4000) rubric?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
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
  @MaxLength(2000)
  @IsNotEmpty()
  studentId: string;

  @IsObject()
  answers: Record<string, string>; // { [questionId]: "A" }
}

// A written material to read questions from (e.g. an AI quiz).
export class ParseTextDto {
  @IsString()
  @MinLength(20)
  @MaxLength(40000)
  text!: string;
}
