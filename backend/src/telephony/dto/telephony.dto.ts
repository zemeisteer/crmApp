import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { TELEPHONY_PROVIDER_NAMES } from '../providers/telephony-providers';

// A center's own telephony account. `apiSecret` may be left out on an edit
// (the stored one stays); it is never sent back.
export class SaveTelephonyAccountDto {
  @IsIn(TELEPHONY_PROVIDER_NAMES)
  provider: (typeof TELEPHONY_PROVIDER_NAMES)[number];

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "API key faqat harf, raqam, '-' va '_' dan iborat" })
  apiKey: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  apiSecret?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['OWN', 'ALL'])
  callsVisibility?: 'OWN' | 'ALL';

  @IsOptional()
  @IsIn(['ADMINS', 'CALL_VIEWERS'])
  recordingsAccess?: 'ADMINS' | 'CALL_VIEWERS';
}

// Who sees what, and on/off: no keys needed.
export class TelephonyPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['OWN', 'ALL'])
  callsVisibility?: 'OWN' | 'ALL';

  @IsOptional()
  @IsIn(['ADMINS', 'CALL_VIEWERS'])
  recordingsAccess?: 'ADMINS' | 'CALL_VIEWERS';
}

export class TelephonyExtensionDto {
  @IsString()
  @Matches(/^\d{1,10}$/, { message: "Ichki raqam faqat raqamlardan iborat (masalan 100)" })
  extension: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  userId: string;
}

export class SetTelephonyExtensionsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => TelephonyExtensionDto)
  items: TelephonyExtensionDto[];
}
