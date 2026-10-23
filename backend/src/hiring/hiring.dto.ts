import { IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

// A person's name: letters (Latin, Cyrillic, Uzbek), spaces, apostrophes, hyphens.
const NAME = /^[A-Za-zÀ-ÖØ-öø-ÿА-Яа-яЁёЎўҚқҒғҲҳʻʼ'‘’ .\-]{2,120}$/;
// A phone: digits with an optional +, spaces, dashes or brackets (8-15 digits).
const PHONE = /^\+?[\d\s()-]{8,24}$/;
const NAME_MSG = "Ismda faqat harflar bo'lsin";
const PHONE_MSG = "Telefon raqami noto'g'ri (masalan: +998 90 123 45 67)";
const EMAIL_MSG = "Email noto'g'ri";

/**
 * A candidate's way through hiring: new → test → interview → demo lesson →
 * decision (offer or rejected) → hired (made a teacher, see HiringService.hire).
 */
export const CANDIDATE_STAGES = ['NEW', 'TEST', 'INTERVIEW', 'DEMO', 'OFFER', 'HIRED', 'REJECTED'] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export class CreateCandidateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  @Matches(NAME, { message: NAME_MSG })
  fullName!: string;

  @IsOptional() @IsString() @Matches(PHONE, { message: PHONE_MSG }) phone?: string;
  @IsOptional() @IsEmail({}, { message: EMAIL_MSG }) @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(100) subject?: string;
  // Where they came from: a job post, a referral, Telegram...
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateCandidateDto {
  @IsOptional() @IsString() @Matches(NAME, { message: NAME_MSG }) fullName?: string;
  // An empty string clears these.
  @IsOptional() @ValidateIf((o: UpdateCandidateDto) => o.phone !== '') @IsString() @Matches(PHONE, { message: PHONE_MSG }) phone?: string;
  @IsOptional() @ValidateIf((o: UpdateCandidateDto) => o.email !== '') @IsEmail({}, { message: EMAIL_MSG }) @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(100) subject?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;

  // HIRED is reached only through "make a teacher".
  @IsOptional() @IsIn(CANDIDATE_STAGES.filter((s) => s !== 'HIRED')) stage?: Exclude<CandidateStage, 'HIRED'>;

  // A test score typed by hand (e.g. a paper test); an online one fills it itself.
  @IsOptional() @IsInt() @Min(0) @Max(100) testPercent?: number;

  @IsOptional() @IsISO8601() interviewAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) interviewScore?: number;
  @IsOptional() @IsString() @MaxLength(4000) interviewNotes?: string;

  @IsOptional() @IsISO8601() demoAt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(5) demoScore?: number;
  @IsOptional() @IsString() @MaxLength(4000) demoNotes?: string;

  @IsOptional() @IsString() @MaxLength(4000) decisionNote?: string;
}

export class QueryCandidatesDto {
  @IsOptional() @IsIn(CANDIDATE_STAGES) stage?: CandidateStage;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}
