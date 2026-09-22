import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTenantDto {
  @IsString()
  name: string;

  @IsString()
  subdomain: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(6)
  adminPassword: string;

  @IsString()
  adminFullName: string;
}

export class UpdateTenantDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  accentColor?: string;

  @IsOptional()
  @IsIn(['TIL_MARKAZI', 'MATEMATIKA', 'IT', 'BOSHQA'])
  category?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  telegramUsername?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  websiteLabel?: string;

  @IsOptional()
  @IsIn(['UZ', 'RU', 'EN'])
  language?: string;

  @IsOptional()
  @IsIn(['UZS', 'USD', 'RUB'])
  currency?: string;
}

export class UpdateTenantStatusDto {
  @IsOptional()
  @IsIn(['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'])
  status?: string;

  // Free text now — references plans.key, which a superadmin can extend
  // beyond the original 3 tiers from the Tariflar page.
  @IsOptional()
  @IsString()
  plan?: string;
}

export class PublicApplyDto {
  @IsString()
  fullName: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  parentPhone?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
