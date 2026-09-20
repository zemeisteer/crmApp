import { IsString } from 'class-validator';

export class GeneratePlatformLinkDto {
  // Free text now — references plans.key, which a superadmin can extend
  // beyond the original 3 tiers.
  @IsString()
  plan: string;

  @IsString()
  forMonth: string;
}
