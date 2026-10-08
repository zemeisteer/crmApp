import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ENTITY_TYPES, FIELD_TYPES } from '../custom-field-values';

export class CustomFieldOptionDto {
  @IsOptional() @IsString() @MaxLength(40)
  id?: string;

  @IsString() @MinLength(1) @MaxLength(80)
  label!: string;

  @IsOptional() @IsBoolean()
  archived?: boolean;
}

export class CreateCustomFieldDto {
  @IsIn(ENTITY_TYPES)
  entityType!: (typeof ENTITY_TYPES)[number];

  @IsString() @MinLength(1) @MaxLength(80)
  label!: string;

  @IsOptional() @IsString() @MaxLength(40)
  key?: string;

  @IsIn(FIELD_TYPES)
  fieldType!: (typeof FIELD_TYPES)[number];

  @IsOptional() @IsBoolean()
  required?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CustomFieldOptionDto)
  options?: CustomFieldOptionDto[];

  @IsOptional() @IsBoolean()
  portalVisible?: boolean;

  @IsOptional() @IsString() @MaxLength(40)
  studentFieldId?: string | null;

  @IsOptional() @IsObject()
  optionMap?: Record<string, string> | null;
}

export class UpdateCustomFieldDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80)
  label?: string;

  @IsOptional() @IsIn(FIELD_TYPES)
  fieldType?: (typeof FIELD_TYPES)[number];

  @IsOptional() @IsBoolean()
  required?: boolean;

  @IsOptional() @IsInt() @Min(0) @Max(10_000)
  sortOrder?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => CustomFieldOptionDto)
  options?: CustomFieldOptionDto[];

  @IsOptional() @IsBoolean()
  portalVisible?: boolean;

  // null unlinks; absent keeps the current link.
  @IsOptional() @IsString() @MaxLength(40)
  studentFieldId?: string | null;

  @IsOptional() @IsObject()
  optionMap?: Record<string, string> | null;
}

export class ListCustomFieldsQuery {
  @IsIn(ENTITY_TYPES)
  entityType!: (typeof ENTITY_TYPES)[number];

  @IsOptional() @IsIn(['0', '1', 'true', 'false'])
  includeArchived?: string;
}
