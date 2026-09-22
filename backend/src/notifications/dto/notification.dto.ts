import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendNotificationDto {
  @IsString()
  @MinLength(1)
  recipient: string;

  @IsIn(['TELEGRAM', 'SMS', 'EMAIL', 'PUSH', 'IN_APP'])
  channel: 'TELEGRAM' | 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';

  @IsOptional()
  @IsIn([
    'ATTENDANCE_ABSENT',
    'ATTENDANCE_LATE',
    'PAYMENT_DUE',
    'PAYMENT_RECEIVED',
    'HOMEWORK_ASSIGNED',
    'HOMEWORK_GRADED',
    'EXAM_RESULT',
    'ANNOUNCEMENT',
    'MANUAL',
  ])
  event?:
    | 'ATTENDANCE_ABSENT'
    | 'ATTENDANCE_LATE'
    | 'PAYMENT_DUE'
    | 'PAYMENT_RECEIVED'
    | 'HOMEWORK_ASSIGNED'
    | 'HOMEWORK_GRADED'
    | 'EXAM_RESULT'
    | 'ANNOUNCEMENT'
    | 'MANUAL';

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  @MinLength(1)
  content: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class UpdateNotificationSettingsDto {
  @IsOptional()
  @IsIn(['eskiz', 'playmobile'])
  smsProvider?: 'eskiz' | 'playmobile';

  @IsOptional()
  @IsString()
  smsApiToken?: string;

  @IsOptional()
  @IsString()
  smsSender?: string;

  @IsOptional()
  @IsBoolean()
  notifyOnAttendance?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnPayment?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnHomework?: boolean;
}

export class QueryNotificationsDto {
  @IsOptional()
  @IsString()
  channel?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  offset?: number;
}

export class SendDebtorRemindersDto {
  @IsOptional()
  @IsString()
  forMonth?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}
