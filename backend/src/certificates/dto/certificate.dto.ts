import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCertificateDto {
  @IsString()
  @IsNotEmpty()
  studentId!: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsOptional()
  grade?: string;

  @IsDateString()
  @IsOptional()
  issueDate?: string;

  @IsString()
  @IsOptional()
  signatoryName?: string;

  @IsString()
  @IsOptional()
  signatoryTitle?: string;

  @IsString()
  @IsOptional()
  description?: string;
}

export class QueryCertificateDto {
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  groupId?: string;

  @IsString()
  @IsOptional()
  search?: string;
}
