import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  content!: string;

  @IsString()
  @IsOptional()
  targetAudience?: string; // 'ALL' | 'STUDENTS' | 'TEACHERS' | 'GROUP'

  @IsString()
  @IsOptional()
  targetGroupId?: string;

  @IsString()
  @IsOptional()
  priority?: string; // 'NORMAL' | 'HIGH' | 'URGENT'

  @IsBoolean()
  @IsOptional()
  sendTelegram?: boolean;
}

export class QueryAnnouncementDto {
  @IsString()
  @IsOptional()
  targetAudience?: string;

  @IsString()
  @IsOptional()
  priority?: string;

  @IsString()
  @IsOptional()
  targetGroupId?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
