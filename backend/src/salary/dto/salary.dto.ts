import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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

export class DisburseSalaryDto {
  @IsString()
  teacherId: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsString()
  forMonth: string; // "2026-09"

  @IsOptional()
  @IsIn(['CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER'])
  paymentMethod?: 'CASH' | 'CLICK' | 'PAYME' | 'BANK_TRANSFER';

  @IsOptional()
  @IsString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
