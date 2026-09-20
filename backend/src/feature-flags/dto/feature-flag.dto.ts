import { IsBoolean, IsString } from 'class-validator';

export class SetFeatureFlagDto {
  @IsString()
  key: string;

  @IsBoolean()
  enabled: boolean;
}
