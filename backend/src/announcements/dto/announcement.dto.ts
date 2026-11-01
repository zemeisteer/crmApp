import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  title!: string;

  @IsString()
  @MaxLength(50000)
  @IsNotEmpty()
  content!: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  targetAudience?: string; // 'ALL' | 'STUDENTS' | 'TEACHERS' | 'GROUP'

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  targetGroupId?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  priority?: string; // 'NORMAL' | 'HIGH' | 'URGENT'

  @IsBoolean()
  @IsOptional()
  sendTelegram?: boolean;
}

export class QueryAnnouncementDto {
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  targetAudience?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  priority?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  targetGroupId?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  search?: string;
}
