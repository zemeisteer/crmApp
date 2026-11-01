import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GeneratePlatformLinkDto {
  // Free text now — references plans.key, which a superadmin can extend
  // beyond the original 3 tiers.
  @IsString()
  @MaxLength(2000)
  plan: string;

  // Ignored: the month is the server's (billing-period.ts nextPaymentMonth).
  // Still accepted so older pages keep working.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  forMonth?: string;
}
