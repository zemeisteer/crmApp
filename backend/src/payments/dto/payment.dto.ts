import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreatePaymentDto {
  @IsString()
  studentId: string;

  @IsInt()
  @Min(0)
  amount: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  discount?: number;

  @IsOptional()
  @IsIn(['CLICK', 'PAYME', 'BANK_TRANSFER', 'CASH'])
  method?: string;

  @IsOptional()
  @IsIn(['PAID', 'PENDING', 'FAILED'])
  status?: string;

  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: "forMonth YYYY-MM formatida bo'lishi kerak" })
  forMonth: string; // "2026-09"

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  // A fresh random value per payment form; sending the same one again
  // (double click, retry after a timeout) returns the first payment. The
  // Idempotency-Key header works too.
  @IsOptional()
  @IsString()
  @Length(8, 120)
  idempotencyKey?: string;
}
