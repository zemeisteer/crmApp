import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min, MaxLength } from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  groupId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  teacherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  roomId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number; // 1 = Monday, 7 = Sunday

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string; // YYYY-MM-DD for one-time lesson

  @IsString()
  @Matches(TIME_REGEX, { message: "startTime 'HH:MM' formatida bo'lishi kerak (masalan: 09:00)" })
  startTime: string;

  @IsString()
  @Matches(TIME_REGEX, { message: "endTime 'HH:MM' formatida bo'lishi kerak (masalan: 10:30)" })
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  onlineMeetingUrl?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELLED', 'COMPLETED'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  allowCollision?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  groupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  teacherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  roomId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_REGEX)
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  onlineMeetingUrl?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELLED', 'COMPLETED'])
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  topic?: string;

  @IsOptional()
  @IsBoolean()
  allowCollision?: boolean;
}

export class CheckConflictDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  groupId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  teacherId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  roomId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string;

  @IsString()
  @Matches(TIME_REGEX)
  startTime: string;

  @IsString()
  @Matches(TIME_REGEX)
  endTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  excludeScheduleId?: string;
}
