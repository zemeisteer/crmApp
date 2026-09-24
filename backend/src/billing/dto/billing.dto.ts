import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GeneratePaymentLinkDto {
  @IsString()
  studentId: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsInt()
  @Min(1000)
  amount: number;

  @IsString()
  forMonth: string;
}

