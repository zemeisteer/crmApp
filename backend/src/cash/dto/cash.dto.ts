import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

export class CloseCashDayDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date YYYY-MM-DD formatida bo'lishi kerak" })
  date: string;

  // The cash actually counted in the drawer.
  @IsInt()
  @Min(0)
  countedCash: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
