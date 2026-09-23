import { IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  login?: string;

  @IsString()
  @MinLength(1)
  password: string;
}
