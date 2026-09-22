import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateExpenseDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsIn(['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'SUPPLIES', 'TAX', 'OTHER'])
  category?: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CLICK', 'PAYME'])
  paymentMethod?: string;

  @IsString()
  @IsNotEmpty()
  date: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateExpenseDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsIn(['RENT', 'UTILITIES', 'SALARY', 'MARKETING', 'SUPPLIES', 'TAX', 'OTHER'])
  category?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsIn(['CASH', 'BANK_TRANSFER', 'CLICK', 'PAYME'])
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
