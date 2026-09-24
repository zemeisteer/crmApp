import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  LEAD_LOST_REASONS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  type LeadLostReason,
  type LeadSource,
  type LeadStatus,
} from '../lead-lifecycle';

export { LEAD_LOST_REASONS, LEAD_SOURCES, LEAD_STATUSES };
export type { LeadLostReason, LeadSource, LeadStatus };

// Pasted contact details often carry stray whitespace.
const trimString = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export const MANUAL_ACTIVITY_TYPES = ['NOTE', 'CALL', 'MESSAGE', 'MEETING'] as const;
export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number];

export class CreateLeadDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName: string;

  @IsString()
  @MaxLength(40)
  phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  secondaryPhone?: string;

  @IsOptional()
  @Transform(trimString)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  desiredSubjectId?: string;

  @IsOptional()
  @IsString()
  desiredCourseId?: string;

  @IsOptional()
  @IsString()
  preferredBranchId?: string;

  @IsOptional()
  @IsString()
  assignedManagerUserId?: string;

  @IsOptional()
  @IsISO8601()
  followUpAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  // Explicit, permissioned (admissions.manage) and audited: create this lead
  // even though an active lead with the same phone/email exists.
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;

  @ValidateIf((o: CreateLeadDto) => o.allowDuplicate === true)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  duplicateReason?: string;
}

// Profile fields only. `status` is accepted solely so a legacy client that
// still PATCHes a status gets a clear 400 pointing at the transition
// endpoint instead of having the field silently stripped.
export class UpdateLeadDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  secondaryPhone?: string | null;

  @IsOptional()
  @Transform(trimString)
  @ValidateIf((o: UpdateLeadDto) => o.email !== null)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  desiredSubjectId?: string | null;

  @IsOptional()
  @IsString()
  desiredCourseId?: string | null;

  @IsOptional()
  @IsString()
  preferredBranchId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @IsString()
  status?: string;
}

export class TransitionLeadDto {
  @IsIn(LEAD_STATUSES)
  toStatus: LeadStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AssignLeadDto {
  // null unassigns.
  @ValidateIf((o: AssignLeadDto) => o.managerUserId !== null)
  @IsString()
  managerUserId: string | null;
}

export class FollowUpDto {
  // null clears the follow-up.
  @ValidateIf((o: FollowUpDto) => o.followUpAt !== null)
  @IsISO8601()
  followUpAt: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class CreateActivityDto {
  @IsIn(MANUAL_ACTIVITY_TYPES)
  type: ManualActivityType;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body: string;

  @IsOptional()
  @IsISO8601()
  occurredAt?: string;
}

export class LoseLeadDto {
  @IsIn(LEAD_LOST_REASONS)
  reason: LeadLostReason;

  // Required when reason is OTHER, so "other" is never an empty bucket.
  @ValidateIf((o: LoseLeadDto) => o.reason === 'OTHER' || o.note !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note?: string;
}

export class ReopenLeadDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2000)
  note: string;
}

export class ArchiveLeadDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export const LEAD_SORTS = ['newest', 'oldest', 'next_follow_up', 'recently_updated'] as const;
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'none'] as const;

export class QueryLeadDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  // Single status or comma-separated list, e.g. "NEW,CONTACTED".
  @IsOptional()
  @Matches(/^(NEW|CONTACTED|TRIAL_BOOKED|TRIAL_ATTENDED|QUALIFIED|ENROLLED|LOST)(,(NEW|CONTACTED|TRIAL_BOOKED|TRIAL_ATTENDED|QUALIFIED|ENROLLED|LOST))*$/)
  status?: string;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @IsString()
  preferredBranchId?: string;

  @IsOptional()
  @IsString()
  desiredSubjectId?: string;

  @IsOptional()
  @IsString()
  desiredCourseId?: string;

  // A user id, "me" or "unassigned".
  @IsOptional()
  @IsString()
  assignedManagerUserId?: string;

  @IsOptional()
  @IsIn(FOLLOW_UP_FILTERS)
  followUp?: (typeof FOLLOW_UP_FILTERS)[number];

  @IsOptional()
  @IsISO8601()
  followUpFrom?: string;

  @IsOptional()
  @IsISO8601()
  followUpTo?: string;

  @IsOptional()
  @IsISO8601()
  createdFrom?: string;

  @IsOptional()
  @IsISO8601()
  createdTo?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  converted?: 'true' | 'false';

  @IsOptional()
  @IsIn(LEAD_LOST_REASONS)
  lostReason?: LeadLostReason;

  @IsOptional()
  @IsIn(['true', 'false'])
  includeArchived?: 'true' | 'false';

  @IsOptional()
  @IsIn(LEAD_SORTS)
  sort?: (typeof LEAD_SORTS)[number];
}

export class FunnelQueryDto {
  // Cohort window on lead creation date (inclusive from, exclusive to).
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsString()
  preferredBranchId?: string;

  @IsOptional()
  @IsString()
  assignedManagerUserId?: string;
}

export class BookTrialDto {
  @IsISO8601()
  scheduledAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class RescheduleTrialDto {
  @IsISO8601()
  scheduledAt: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(240)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  teacherId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  groupId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class TrialOutcomeDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export const STUDENT_RESOLUTIONS = ['AUTO', 'CREATE_NEW', 'LINK_EXISTING'] as const;
export type StudentResolution = (typeof STUDENT_RESOLUTIONS)[number];

export class ConvertLeadDto {
  // AUTO: create a student when none matches, link the single exact
  // (phone + name) match, and refuse anything ambiguous with 409.
  @IsOptional()
  @IsIn(STUDENT_RESOLUTIONS)
  studentResolution?: StudentResolution;

  @ValidateIf((o: ConvertLeadDto) => o.studentResolution === 'LINK_EXISTING')
  @IsString()
  existingStudentId?: string;

  // Student profile overrides; default to the lead's own data.
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName?: string;

  @IsOptional()
  @IsIn(['MALE', 'FEMALE'])
  gender?: 'MALE' | 'FEMALE';

  @IsOptional()
  @IsISO8601()
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  // Stored as the student's parentPhone. Linking a guardian *user account*
  // stays with the existing student guardian endpoint.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  guardianPhone?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  groupIds?: string[];

  // First invoice is created through InvoicesService for the first group's
  // enrollment. Payments and gateway records are never touched here.
  @IsOptional()
  @IsBoolean()
  createInvoice?: boolean;

  @ValidateIf((o: ConvertLeadDto) => o.createInvoice === true)
  @Matches(/^\d{4}-\d{2}$/, { message: 'invoiceForMonth must be in YYYY-MM format' })
  invoiceForMonth?: string;

  @ValidateIf((o: ConvertLeadDto) => o.createInvoice === true)
  @IsISO8601()
  invoiceDueDate?: string;

  // Defaults to the group's monthly price.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  invoiceAmount?: number;
}
