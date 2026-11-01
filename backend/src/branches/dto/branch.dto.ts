import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MaxLength(2000)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mapUrl?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() mapUrl?: string;
}
