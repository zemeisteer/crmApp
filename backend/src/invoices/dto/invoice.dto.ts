import { IsEnum, IsInt, IsISO8601, IsOptional, IsPositive, IsString, Matches } from 'class-validator';

export class CreateInvoiceDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  enrollmentId?: string;

  @IsInt()
  @IsPositive()
  amount: number;

  @IsISO8601()
  dueDate: string;

  @Matches(/^\d{4}-\d{2}$/, { message: 'forMonth must be in YYYY-MM format' })
  forMonth: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class QueryInvoicesDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/)
  forMonth?: string;

  @IsOptional()
  @IsEnum(['DRAFT', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED'])
  status?: 'DRAFT' | 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';

  @IsOptional()
  @IsString()
  overdueOnly?: string;
}
