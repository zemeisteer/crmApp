import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { MAX_MONEY } from '../common/money';

// Both empty takes the card off the cabinet.
export class SetCardDto {
  @IsOptional() @IsString() @MaxLength(32) cardNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) cardHolder?: string;
}

export class ConfirmClaimDto {
  // The amount seen on the receipt, when it differs from what was typed.
  @IsOptional() @IsInt() @Min(1000) @Max(MAX_MONEY) amount?: number;
}

export class RejectClaimDto {
  @IsString() @MaxLength(300) reason!: string;
}
