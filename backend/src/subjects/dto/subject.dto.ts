import { IsArray, IsIn, IsNumber, IsOptional, IsString, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSubjectDto {
  @IsString()
  @MaxLength(2000)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  color?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class UpdateSubjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  color?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class CreateCourseDto {
  @IsString()
  @MaxLength(2000)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsNumber()
  durationMonths?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  price?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  subjectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsNumber()
  durationMonths?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  price?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'ARCHIVED';
}

export class BulkSubjectItemDto {
  @IsString()
  @MaxLength(2000)
  name: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  courses?: string[];
}

export class BulkCreateSubjectsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkSubjectItemDto)
  subjects: BulkSubjectItemDto[];
}
