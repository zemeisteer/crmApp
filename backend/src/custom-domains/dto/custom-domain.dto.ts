import { IsString, MaxLength } from 'class-validator';

export class AddCustomDomainDto {
  @IsString()
  @MaxLength(253)
  domain: string;
}
