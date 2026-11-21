import { IsEmail, IsInt, IsOptional, IsString, Matches, Min, MinLength, Max, MaxLength } from 'class-validator';

// A stored upload's name (see files.service isStoredFileName).
const PHOTO = /^[A-Za-z0-9_-]{8,64}\.(jpg|png|webp)$/;
const PHOTO_OR_EMPTY = /^([A-Za-z0-9_-]{8,64}\.(jpg|png|webp))?$/;
import { MAX_MONEY } from '../../common/money';

export class CreateTeacherDto {
  @IsString()
  @MaxLength(2000)
  fullName: string;

  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() salaryType?: string;
  @IsOptional() @IsInt() @Max(MAX_MONEY) salaryValue?: number;
  @IsOptional() @IsString() @MaxLength(60) score?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) experienceYears?: number;
  @IsOptional() @IsString() @Matches(PHOTO, { message: "Rasm noto'g'ri" }) photoPath?: string;
}

export class UpdateTeacherDto {
  @IsOptional() @IsString() @MaxLength(60) score?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) experienceYears?: number;
  // "" removes the photo.
  @IsOptional() @IsString() @Matches(PHOTO_OR_EMPTY, { message: "Rasm noto'g'ri" }) photoPath?: string;
  @IsOptional() @IsString() fullName?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() subject?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() birthDate?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() salaryType?: string;
  @IsOptional() @IsInt() @Max(MAX_MONEY) salaryValue?: number;
}

// Login for a teacher: email + first password (they can change it later).
export class TeacherAccountDto {
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(2000)
  @MinLength(6)
  password: string;
}
