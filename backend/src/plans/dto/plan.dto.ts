import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  price: number;

  @IsOptional()
  @IsString()
  features?: string;

  @IsOptional()
  @IsBoolean()
  popular?: boolean;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) price?: number;
  @IsOptional() @IsString() features?: string;
  @IsOptional() @IsBoolean() popular?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
