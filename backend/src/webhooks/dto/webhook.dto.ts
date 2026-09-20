import { IsIn, IsOptional, IsString, IsUrl } from 'class-validator';

const EVENTS = ['*', 'payment.created', 'attendance.marked', 'student.created'] as const;

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url: string;

  @IsIn(EVENTS)
  event: string;
}

export class UpdateWebhookDto {
  @IsOptional() @IsUrl({ require_tld: false }) url?: string;
  @IsOptional() @IsIn(EVENTS) event?: string;
  @IsOptional() active?: boolean;
}
