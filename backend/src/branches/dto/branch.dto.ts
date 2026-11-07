import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// An Uzbek number (+998 and 9 digits, spaces or dashes allowed) or nothing.
const BRANCH_PHONE = /^(\+?998[\s-]?\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2})?$/;
const BRANCH_PHONE_MSG = "Telefon +998 va 9 ta raqam bo'lsin (masalan +998 71 123 45 67)";

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
  @Matches(BRANCH_PHONE, { message: BRANCH_PHONE_MSG })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mapUrl?: string;
}

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() @Matches(BRANCH_PHONE, { message: BRANCH_PHONE_MSG }) phone?: string;
  @IsOptional() @IsString() mapUrl?: string;
}
