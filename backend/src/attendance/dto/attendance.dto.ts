import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class AttendanceEntryDto {
  @IsString()
  @MaxLength(2000)
  studentId: string;

  // The values the database's attendance_status type holds; anything else
  // (EXCUSED was accepted here once) would fail at the database with a 500.
  @IsIn(['PRESENT', 'ABSENT', 'LATE'])
  status: string;
}

export class MarkAttendanceDto {
  @IsString()
  @MaxLength(2000)
  groupId: string;

  @IsString()
  @MaxLength(2000)
  date: string; // "2026-09-19"

  // Which lesson of that day (its timetable row, as GET /api/lessons gives
  // it); needed when the group has several that day.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scheduleId?: string;

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
  @MaxLength(2000)
  groupId: string;
}

export class QueryAttendanceDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  groupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  studentId?: string;
  // One lesson's marks (its timetable row); "none": the day-level ones.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scheduleId?: string;

  // A date range (YYYY-MM-DD, inclusive) instead of one date.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  from?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
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
  @MaxLength(2000)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  groupId?: string;

  // Which lesson of that day, when the group has several and none is going on now.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  scheduleId?: string;
}

