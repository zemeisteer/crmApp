import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateHomeworkDto {
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
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  maxScore?: number;
}

export class UpdateHomeworkDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() dueDate?: string;
  @IsOptional() @IsNumber() @Min(1) maxScore?: number;
}

export class SetCompletionDto {
  @IsString()
  studentId: string;

  @IsBoolean()
  completed: boolean;
}

export class SubmitHomeworkDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  submissionText?: string;

  @IsOptional()
  @IsString()
  attachmentUrl?: string;
}

// Text (e.g. an AI-written task) to attach to the homework as a PDF.
export class AttachTextDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60000)
  content: string;
}

export class GradeHomeworkDto {
  @IsString()
  studentId: string;

  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}
