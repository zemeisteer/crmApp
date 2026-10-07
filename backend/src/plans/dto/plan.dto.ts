import { IsBoolean, IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class CreatePlanDto {
  @IsString()
  key: string;

  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  @Max(MAX_MONEY)
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
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MONEY) price?: number;
  @IsOptional() @IsString() features?: string;
  @IsOptional() @IsBoolean() popular?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
