import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CheckSubdomainDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Subdomain faqat kichik lotin harflari, raqamlar va defisdan iborat bolishi kerak',
  })
  subdomain: string;
}

export class ProfileStepDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}

export class CategoriesStepDto {
  @IsArray()
  @IsString({ each: true })
  categories: string[];
}

export class WorkspaceStepDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'Subdomain faqat kichik lotin harflari, raqamlar va defisdan iborat bolishi kerak',
  })
  subdomain: string;
}

export class BranchStepDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
