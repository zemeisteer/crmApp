import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  studentId: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsIn(['CLICK', 'PAYME', 'BANK_TRANSFER', 'CASH'])
  method?: string;

  @IsOptional()
  @IsIn(['PAID', 'PENDING', 'FAILED'])
  status?: string;

  @IsString()
  forMonth: string; // "2026-09"

  @IsOptional()
  @IsString()
  paidAt?: string;
}
