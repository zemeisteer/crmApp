import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class CreateRoomDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  color?: string;
}

export class UpdateRoomDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  color?: string;
}
