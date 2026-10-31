import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Max, MaxLength } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class CreateExpenseDto {
  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsIn(['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'SUPPLIES', 'TAX', 'OTHER'])
  category?: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_MONEY)
  amount: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CLICK', 'PAYME'])
  paymentMethod?: string;

  @IsString()
  @MaxLength(2000)
  @IsNotEmpty()
  date: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  notes?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  title?: string;

  @IsOptional()
  @IsIn(['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'SUPPLIES', 'TAX', 'OTHER'])
  category?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_MONEY)
  amount?: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CLICK', 'PAYME'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  branchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  notes?: string;
}
