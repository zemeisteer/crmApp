import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

const STATUSES = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'];

export class ListSubscriptionsDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  @IsOptional() @IsString() @MaxLength(60) plan?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(100) pageSize?: number;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsString() @MaxLength(60) plan?: string;
  @IsOptional() @IsIn(STATUSES) status?: string;
  // An ISO date; null clears the trial's end.
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) trialEndsAt?: string | null;
}

export class RecordPaymentDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "Oy YYYY-MM ko'rinishida bo'lishi kerak" })
  forMonth: string;

  // Omitted: the center's current tariff and its price.
  @IsOptional() @IsString() @MaxLength(60) plan?: string;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_MONEY) amount?: number;
}

export class SaveIntegrationDto {
  // The admin's own password, asked for on every change of a key.
  @IsString() @MinLength(1) @MaxLength(200)
  password: string;

  // Setting name -> its new value; null or "" removes the stored value.
  // Names and values are checked against the integration in the service.
  @IsObject()
  values: Record<string, string | null>;
}
