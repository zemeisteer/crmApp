import { IsBoolean, IsString, MaxLength } from 'class-validator';

export class SetFeatureFlagDto {
  @IsString()
  @MaxLength(2000)
  key: string;

  @IsBoolean()
  enabled: boolean;
}

export class SetFlagStateDto {
  @IsBoolean()
  enabled: boolean;
}
