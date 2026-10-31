import {
  IsArray,
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
  @MaxLength(2000)
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  logoUrl?: string;
}

export class CategoriesStepDto {
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
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
  @MaxLength(2000)
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  phone?: string;
}
