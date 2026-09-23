import { IsEmail, IsIn, IsOptional, IsString, MinLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  centerName: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{3,30}$/, {
    message: 'Sub-domen faqat kichik lotin harflari, raqam va - dan iborat bo\'lishi kerak',
  })
  subdomain?: string;

  @IsOptional()
  category?: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsString()
  @MinLength(2)
  fullName: string;
}
