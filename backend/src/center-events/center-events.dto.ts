import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export const EVENT_KINDS = ['MEETING', 'COMPETITION', 'EVENT', 'OTHER'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const EVENT_FORMATS = ['OFFLINE', 'ONLINE'] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];
export const EVENT_AUDIENCES = ['STAFF', 'STUDENTS', 'ALL'] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateCenterEventDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsIn(EVENT_KINDS)
  kind!: EventKind;

  @IsIn(EVENT_FORMATS)
  format!: EventFormat;

  @Matches(DATE, { message: 'Sana YYYY-MM-DD ko\'rinishida bo\'lsin' })
  date!: string;

  @Matches(TIME, { message: 'Vaqt HH:MM ko\'rinishida bo\'lsin' })
  startTime!: string;

  @IsOptional()
  @Matches(TIME, { message: 'Vaqt HH:MM ko\'rinishida bo\'lsin' })
  endTime?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingUrl?: string;

  @IsOptional()
  @IsIn(EVENT_AUDIENCES)
  audience?: EventAudience;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCenterEventDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsIn(EVENT_KINDS)
  kind?: EventKind;

  @IsOptional()
  @IsIn(EVENT_FORMATS)
  format?: EventFormat;

  @IsOptional()
  @Matches(DATE, { message: 'Sana YYYY-MM-DD ko\'rinishida bo\'lsin' })
  date?: string;

  @IsOptional()
  @Matches(TIME, { message: 'Vaqt HH:MM ko\'rinishida bo\'lsin' })
  startTime?: string;

  @IsOptional()
  @Matches(TIME, { message: 'Vaqt HH:MM ko\'rinishida bo\'lsin' })
  endTime?: string | null;

  @IsOptional()
  @IsString()
  roomId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  location?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meetingUrl?: string | null;

  @IsOptional()
  @IsIn(EVENT_AUDIENCES)
  audience?: EventAudience;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class ListCenterEventsDto {
  @Matches(DATE)
  from!: string;

  @Matches(DATE)
  to!: string;
}
