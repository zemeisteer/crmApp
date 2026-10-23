import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

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
  fullName!: string;

  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(100) subject?: string;
  // Where they came from: a job post, a referral, Telegram...
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string;
}

export class UpdateCandidateDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) fullName?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;
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
