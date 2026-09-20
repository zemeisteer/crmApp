import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsString()
  subject: string;

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
  @IsInt()
  @Min(0)
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
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() teacherId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsInt() @Min(1) maxStudents?: number;
  @IsOptional() @IsString() schedule?: string;
  @IsOptional() @IsString() scheduleDays?: string;
  @IsOptional() @IsString() startTime?: string;
  @IsOptional() @IsInt() @Min(0) monthlyPrice?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsInt() @Min(1) durationMonths?: number;
}
