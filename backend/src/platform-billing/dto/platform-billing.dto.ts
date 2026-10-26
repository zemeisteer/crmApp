import { IsOptional, IsString } from 'class-validator';

export class GeneratePlatformLinkDto {
  // Free text now — references plans.key, which a superadmin can extend
  // beyond the original 3 tiers.
  @IsString()
  plan: string;

  // Ignored: the month is the server's (billing-period.ts nextPaymentMonth).
  // Still accepted so older pages keep working.
  @IsOptional()
  @IsString()
  forMonth?: string;
}
