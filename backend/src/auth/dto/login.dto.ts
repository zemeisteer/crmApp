import { IsOptional, IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  login?: string;

  @IsString()
  @MaxLength(2000)
  @MinLength(1)
  password: string;
}
