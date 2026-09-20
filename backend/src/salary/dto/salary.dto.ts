import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateSalaryPaymentDto {
  @IsString()
  teacherId: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  forMonth: string; // "2026-09"

  @IsOptional()
  @IsString()
  paidAt?: string;
}
