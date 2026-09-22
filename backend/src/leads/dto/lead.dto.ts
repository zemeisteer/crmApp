import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'TRIAL_BOOKED',
  'TRIAL_ATTENDED',
  'QUALIFIED',
  'ENROLLED',
  'LOST',
] as const;

export const LEAD_SOURCES = [
  'INSTAGRAM',
  'TELEGRAM',
  'WEBSITE',
  'RECOMMENDATION',
  'BANNER',
  'WALK_IN',
  'OTHER',
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type LeadSource = (typeof LEAD_SOURCES)[number];

export class CreateLeadDto {
  @IsString()
  fullName: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  parentPhone?: string;

  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  trialDate?: string;

  @IsOptional()
  @IsString()
  trialGroupId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  parentPhone?: string;

  @IsOptional()
  @IsIn(LEAD_STATUSES)
  status?: LeadStatus;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsDateString()
  trialDate?: string;

  @IsOptional()
  @IsString()
  trialGroupId?: string;

  @IsOptional()
  @IsString()
  lostReason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ConvertLeadDto {
  @IsOptional()
  @IsString({ each: true })
  groupIds?: string[];

  @IsOptional()
  @IsIn(['MALE', 'FEMALE'])
  gender?: 'MALE' | 'FEMALE';

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class QueryLeadDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
