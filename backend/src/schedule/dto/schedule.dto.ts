import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateScheduleDto {
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number; // 1 = Monday, 7 = Sunday

  @IsOptional()
  @IsString()
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
  onlineMeetingUrl?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELLED', 'COMPLETED'])
  status?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsBoolean()
  allowCollision?: boolean;
}

export class UpdateScheduleDto {
  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
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
  onlineMeetingUrl?: string;

  @IsOptional()
  @IsIn(['SCHEDULED', 'CANCELLED', 'COMPLETED'])
  status?: string;

  @IsOptional()
  @IsString()
  topic?: string;

  @IsOptional()
  @IsBoolean()
  allowCollision?: boolean;
}

export class CheckConflictDto {
  @IsString()
  @IsNotEmpty()
  groupId: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  date?: string;

  @IsString()
  @Matches(TIME_REGEX)
  startTime: string;

  @IsString()
  @Matches(TIME_REGEX)
  endTime: string;

  @IsOptional()
  @IsString()
  excludeScheduleId?: string;
}
