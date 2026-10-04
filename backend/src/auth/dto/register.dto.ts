import { IsEmail, IsOptional, IsString, MinLength, Matches } from 'class-validator';

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
  // Same rule and wording as isPasswordStrongEnough, so the form never shows
  // the validator's raw English text.
  @MinLength(8, { message: "Parol kamida 8 ta belgidan iborat bo'lishi kerak" })
  password: string;

  @IsString()
  @MinLength(2)
  fullName: string;
}
