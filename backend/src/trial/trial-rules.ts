/**
 * What a center on its free trial may do, and what happens after the trial
 * ends. Every value is read from the environment (backend/.env) at the time
 * of use; unset means the default in brackets:
 *
 * - SIGNUP_PHONE_CHECK (on): sign-up needs a phone confirmed with a code; one
 *   trial per number.
 * - TRIAL_LIMITS (on): TRIAL_MAX_STUDENTS (30), TRIAL_MAX_STAFF (3, besides
 *   the owner), TRIAL_AI_PER_DAY (20 AI requests), no bulk import.
 * - After the trial ends: TRIAL_READONLY_DAYS (14) days to look but not
 *   change; then only the plan and payment pages open.
 * - TRIAL_PURGE (off): an unpaid trial is deleted TRIAL_PURGE_DAYS (60) days
 *   after it ended, after two e-mails to the owners (14 and 7 days before).
 *   Off by default: deleting is for the platform admin to switch on.
 * - SUPERADMIN_2FA (on in production): the platform pages open only once the
 *   platform admin has two-step sign-in on.
 */

const OFF = new Set(['off', 'false', '0', 'no']);

function flag(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return !OFF.has(v);
}

function count(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

export interface TrialRules {
  phoneCheck: boolean;
  limits: boolean;
  maxStudents: number;
  maxStaff: number;
  aiPerDay: number;
  readOnlyDays: number;
  purge: boolean;
  purgeDays: number;
  superadmin2fa: boolean;
}

export function trialRules(): TrialRules {
  return {
    phoneCheck: flag('SIGNUP_PHONE_CHECK', true),
    limits: flag('TRIAL_LIMITS', true),
    maxStudents: count('TRIAL_MAX_STUDENTS', 30),
    maxStaff: count('TRIAL_MAX_STAFF', 3),
    aiPerDay: count('TRIAL_AI_PER_DAY', 20),
    readOnlyDays: count('TRIAL_READONLY_DAYS', 14),
    purge: flag('TRIAL_PURGE', false),
    purgeDays: Math.max(count('TRIAL_PURGE_DAYS', 60), 21),
    superadmin2fa: flag('SUPERADMIN_2FA', process.env.NODE_ENV === 'production'),
  };
}

/**
 * Where a center is in its life:
 * - ACTIVE: paying (or suspended - that has its own rules);
 * - TRIAL: on the free trial;
 * - READ_ONLY: the trial ended; it may look but not change anything;
 * - LOCKED: the read-only days are over too; only the plan and payment pages.
 */
export type TrialStage = 'ACTIVE' | 'TRIAL' | 'READ_ONLY' | 'LOCKED';

const DAY = 86_400_000;

export function trialStage(
  tenant: { status: string; trialEndsAt: Date | string | null; trialPurgeOn?: Date | string | null },
  now: Date = new Date(),
  rules: TrialRules = trialRules(),
): { stage: TrialStage; endsAt: Date | null; lockAt: Date | null; purgeAt: Date | null } {
  if (tenant.status !== 'TRIAL') return { stage: 'ACTIVE', endsAt: null, lockAt: null, purgeAt: null };
  if (!tenant.trialEndsAt) return { stage: 'TRIAL', endsAt: null, lockAt: null, purgeAt: null };
  const endsAt = new Date(tenant.trialEndsAt);
  const lockAt = new Date(endsAt.getTime() + rules.readOnlyDays * DAY);
  // The date the notices named once they began (trial-lifecycle.service.ts);
  // before that, the earliest it can be (two weeks' notice comes first).
  const purgeAt = !rules.purge ? null
    : tenant.trialPurgeOn ? new Date(tenant.trialPurgeOn)
    : new Date(Math.max(endsAt.getTime() + rules.purgeDays * DAY, now.getTime() + 14 * DAY));
  const stage: TrialStage = now < endsAt ? 'TRIAL' : now < lockAt ? 'READ_ONLY' : 'LOCKED';
  return { stage, endsAt, lockAt, purgeAt };
}
