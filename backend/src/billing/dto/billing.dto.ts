import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min, Max, MaxLength } from 'class-validator';
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

// A center's own Click / Payme account. `secret` may be left out on an
// edit (the stored one stays); it is never sent back.
export class SavePaymentAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]+$/, { message: "Merchant ID faqat harf, raqam, '-' va '_' dan iborat" })
  merchantId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9_-]*$/, { message: "Service ID faqat harf, raqam, '-' va '_' dan iborat" })
  serviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  secret?: string;
}
