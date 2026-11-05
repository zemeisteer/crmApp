import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive, IsString, Matches, Max, MaxLength } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class CreateInvoiceDto {
  @IsString()
  @MaxLength(2000)
  studentId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  enrollmentId?: string;

  @IsInt()
  @IsPositive()
  @Max(MAX_MONEY)
  amount: number;

  @IsISO8601()
  dueDate: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'forMonth must be in YYYY-MM format' })
  forMonth: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;
}

export class QueryInvoicesDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  studentId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  forMonth?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  overdueOnly?: string;
}
