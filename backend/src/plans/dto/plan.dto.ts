import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, Max, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { FEATURES, LIMITS } from '../entitlements';

/** Only known keys: a feature is true/false, a limit a whole number >= 0 or null (none). */
@ValidatorConstraint({ name: 'entitlements' })
export class EntitlementsShape implements ValidatorConstraintInterface {
  validate(v: unknown) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    return Object.entries(v as Record<string, unknown>).every(([k, x]) =>
      (FEATURES as readonly string[]).includes(k) ? typeof x === 'boolean'
        : (LIMITS as readonly string[]).includes(k) ? x === null || (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1_000_000)
        : false);
  }
  defaultMessage() {
    return `entitlements: faqat ${[...FEATURES, ...LIMITS].join(', ')}; funksiya true/false, limit butun son yoki null`;
  }
}
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

  @IsOptional() @IsString() featuresRu?: string;
  @IsOptional() @IsString() featuresEn?: string;

  @IsOptional()
  @IsBoolean()
  popular?: boolean;

  // SMS messages (through the platform's provider) are part of this plan.
  @IsOptional()
  @IsBoolean()
  smsIncluded?: boolean;

  @IsOptional()
  @Validate(EntitlementsShape)
  entitlements?: Record<string, boolean | number | null>;
}

export class TranslateFeaturesDto {
  @IsString()
  @MaxLength(8000)
  features: string;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MAX_MONEY) price?: number;
  @IsOptional() @IsString() features?: string;
  @IsOptional() @IsString() featuresRu?: string;
  @IsOptional() @IsString() featuresEn?: string;
  @IsOptional() @IsBoolean() popular?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsBoolean() smsIncluded?: boolean;
  @IsOptional() @Validate(EntitlementsShape) entitlements?: Record<string, boolean | number | null>;
}
