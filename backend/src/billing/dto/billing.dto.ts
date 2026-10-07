import { IsInt, IsOptional, IsString, Min, Max } from 'class-validator';
import { MAX_MONEY } from '../../common/money';

export class GeneratePaymentLinkDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsInt()
  @Min(1000)
  @Max(MAX_MONEY)
  amount: number;

  @IsString()
  forMonth: string;
}

