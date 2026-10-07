import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min, Max } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

// One payout (installment) of a teacher's month.
export class DisburseSalaryDto {
  @IsString()
  teacherId: string;

  @IsInt()
  @Min(1)
  @Max(MAX_MONEY)
  amount: number;

  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "forMonth YYYY-MM formatida bo'lishi kerak" })
  forMonth: string; // "2026-09"

  @IsOptional()
  @IsIn(['CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER'])
  paymentMethod?: 'CASH' | 'CLICK' | 'PAYME' | 'BANK_TRANSFER';

  @IsOptional()
  @IsString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReverseSalaryDto {
  @IsString()
  @MaxLength(500)
  reason: string;
}

export class LinkSalaryExpenseDto {
  @IsString()
  expenseId: string;
}
