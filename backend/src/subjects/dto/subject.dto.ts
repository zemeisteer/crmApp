import { IsArray, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSubjectDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class CreateCourseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  durationMonths?: number;

  @IsOptional()
  @IsString()
  price?: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  durationMonths?: number;

  @IsOptional()
  @IsString()
  price?: string;
}

export class BulkSubjectItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  courses?: string[];
}

export class BulkCreateSubjectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSubjectItemDto)
  subjects: BulkSubjectItemDto[];
}
