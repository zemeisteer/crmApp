import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

export class AttendanceEntryDto {
  @IsString()
  studentId: string;

  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED'])
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

