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
  @IsString()
  @MaxLength(2000)
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
  @MaxLength(2000)
  studentId: string;

  @IsBoolean()
  completed: boolean;
}

export class SubmitHomeworkDto {
  @IsString()
  @MaxLength(2000)
  studentId: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  submissionText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
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
  @MaxLength(2000)
  studentId: string;

  @IsNumber()
  @Min(0)
  score: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  feedback?: string;
}
