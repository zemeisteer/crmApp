import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class AttendanceEntryDto {
  @IsString()
  studentId: string;

  // The values the database's attendance_status type holds; anything else
  // (EXCUSED was accepted here once) would fail at the database with a 500.
  @IsIn(['PRESENT', 'ABSENT', 'LATE'])
  status: string;
}

export class MarkAttendanceDto {
  @IsString()
  groupId: string;

  @IsString()
  date: string; // "2026-09-19"

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AttendanceEntryDto)
  entries: AttendanceEntryDto[];

  // What was covered in this lesson; an empty string clears it.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  topic?: string;
}

export class LessonTopicsQueryDto {
  @IsString()
  groupId: string;
}

export class QueryAttendanceDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  // A date range (YYYY-MM-DD, inclusive) instead of one date.
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  // With page: one page (pageSize default 100, max 500) and the total.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}

export class QrCheckInDto {
  @IsString()
  code: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  groupId?: string;
}

