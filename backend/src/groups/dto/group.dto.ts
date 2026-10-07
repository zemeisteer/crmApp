import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, Max } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsString()
  subject: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsIn(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED'])
  status?: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxStudents?: number;

  @IsOptional()
  @IsString()
  schedule?: string;

  @IsOptional()
  @IsString()
  scheduleDays?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  monthlyPrice?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMonths?: number;
}

export class UpdateGroupDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() courseId?: string;
  @IsOptional() @IsIn(['PLANNED', 'ACTIVE', 'COMPLETED', 'ARCHIVED']) status?: 'PLANNED' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() teacherId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsInt() @Min(1) maxStudents?: number;
  @IsOptional() @IsString() schedule?: string;
  @IsOptional() @IsString() scheduleDays?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsString() endTime?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MONEY) monthlyPrice?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) durationMonths?: number;
}

// "From <month> on this group cost <monthlyPrice>" - a past price put on record.
export class ConfirmGroupPriceDto {
  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: "month YYYY-MM formatida bo'lishi kerak" })
  month: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
  monthlyPrice: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
