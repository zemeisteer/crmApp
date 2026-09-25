import { Equals, IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

// Anonymous form on a center's public site. Every field is bounded because
// anyone on the internet can post it.
export class PublicApplyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  parentPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subject?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // Explicit consent to be contacted / to have the data stored.
  @Equals(true, { message: "Shaxsiy ma'lumotlarni qayta ishlashga rozilik berilishi shart" })
  consent: boolean;

  // Honeypot: visually hidden on the form, so only bots fill it in.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website?: string;

  // Epoch ms when the form was rendered; submissions faster than a human
  // could type are treated as bots.
  @IsOptional()
  @IsInt()
  formStartedAt?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmSource?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmMedium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  utmCampaign?: string;
}
