import { IsInt, IsString, Min } from 'class-validator';

export class GeneratePaymentLinkDto {
  @IsString()
  studentId: string;

  @IsInt()
  @Min(1000)
  amount: number;

  @IsString()
  forMonth: string;
}
