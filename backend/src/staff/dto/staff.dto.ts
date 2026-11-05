import { IsArray, IsEmail, IsIn, IsOptional, IsString, MinLength, MaxLength } from 'class-validator';
import { ACCESS_KEYS } from '../../access/catalog';

export class CreateStaffDto {
  @IsString()
  @MaxLength(2000)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(2000)
  @MinLength(6)
  password: string;

  @IsIn(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER', 'ACCOUNTANT'])
  role: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  permissions?: string[];

  // The member's own list (keys of access/catalog.ts); null: the role's default.
  @IsOptional()
  @IsArray()
  @IsIn(ACCESS_KEYS, { each: true })
  access?: string[] | null;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsIn(['ADMIN', 'MANAGER', 'RECEPTIONIST', 'TEACHER', 'ACCOUNTANT'])
  role?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  permissions?: string[];

  // The member's own list (keys of access/catalog.ts); null: the role's default.
  @IsOptional()
  @IsArray()
  @IsIn(ACCESS_KEYS, { each: true })
  access?: string[] | null;
}
