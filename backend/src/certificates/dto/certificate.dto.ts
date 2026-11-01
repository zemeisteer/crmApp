import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCertificateDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  studentId!: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  groupId?: string;

  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  title!: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  grade?: string;

  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  signatoryName?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  signatoryTitle?: string;

  @IsString()
  @MaxLength(50000)
  @IsOptional()
  description?: string;
}

export class QueryCertificateDto {
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  studentId?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  groupId?: string;

  @IsString()
  @MaxLength(2000)
  @IsOptional()
  search?: string;
}
