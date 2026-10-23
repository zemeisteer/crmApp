import { trialRules, trialStage, type TrialRules } from './trial-rules';

/**
 * What a center may do, by where it is in its life - one table for every
 * door (TrialGuard, TrialInterceptor, invitation accept, the students' AI
 * tutor, SMS and reminders), so they cannot answer differently:
 *
 *   state      reads   writes   ALWAYS_OPEN (sign-in, plans, payment, export, delete)
 *   ACTIVE     yes     yes      yes
 *   TRIAL      yes     yes      yes          (trial limits apply: trial-limits.ts)
 *   READ_ONLY  yes     no       yes          403 TRIAL_READ_ONLY
 *   LOCKED     no      no       yes          403 TRIAL_LOCKED
 *   SUSPENDED  yes     no       yes          403 CENTER_SUSPENDED, or BILLING_SUSPENDED
 *                                             (suspended for non-payment: paying lifts it)
 *
 * Payment provider callbacks carry no signed-in member and are not concerned.
 * The platform admin, and the student and parent cabinets, are not either
 * (the cabinets have their own checks where they cost the platform: the AI
 * tutor, SMS).
 */
export const ALWAYS_OPEN = [
  /^[A-Z]+ \/api\/auth\//,
  /^GET \/api\/plans(\/public)?$/,
  /^POST \/api\/platform-billing\/(click|payme)\/link$/,
  /^GET \/api\/tenants\/me\/export$/,
  /^DELETE \/api\/tenants\/me$/,
];

export type CenterState = 'ACTIVE' | 'TRIAL' | 'READ_ONLY' | 'LOCKED' | 'SUSPENDED';
export type AccessRefusal = { code: 'TRIAL_READ_ONLY' | 'TRIAL_LOCKED' | 'CENTER_SUSPENDED' | 'BILLING_SUSPENDED'; message: string };

type CenterRow = { status: string; trialEndsAt: Date | string | null; suspendedReason?: string | null };

const REFUSALS: Record<AccessRefusal['code'], string> = {
  TRIAL_READ_ONLY: "Sinov muddati tugagan: ma'lumotlarni ko'rish mumkin, o'zgartirish uchun tarifni faollashtiring.",
  TRIAL_LOCKED: 'Sinov muddati tugagan. Markazdan foydalanishni davom ettirish uchun tarifni faollashtiring.',
  CENTER_SUSPENDED: "Markazingiz to'xtatilgan. Administrator bilan bog'laning.",
  BILLING_SUSPENDED: "To'lov muddati o'tgan: ma'lumotlarni ko'rish mumkin. Davom etish uchun tarifni to'lang.",
};
const refuse = (code: AccessRefusal['code']): AccessRefusal => ({ code, message: REFUSALS[code] });

export function centerState(center: CenterRow, now = new Date(), rules: TrialRules = trialRules()): CenterState {
  if (center.status === 'SUSPENDED') return 'SUSPENDED';
  if (center.status !== 'TRIAL') return 'ACTIVE';
  const { stage } = trialStage(center, now, rules);
  return stage === 'ACTIVE' ? 'TRIAL' : stage;
}

/** The answer for one request (`route` as routeIdOf gives it: "POST /api/students"). */
export function centerAccess(center: CenterRow, method: string, route: string, now = new Date(), rules: TrialRules = trialRules()): AccessRefusal | null {
  if (ALWAYS_OPEN.some((r) => r.test(route))) return null;
  const state = centerState(center, now, rules);
  const write = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (state === 'LOCKED') return refuse('TRIAL_LOCKED');
  if (state === 'READ_ONLY' && write) return refuse('TRIAL_READ_ONLY');
  if (state === 'SUSPENDED' && write) return refuse(center.suspendedReason === 'NON_PAYMENT' ? 'BILLING_SUSPENDED' : 'CENTER_SUSPENDED');
  return null;
}

/**
 * For work that is not a staff request but changes the center or costs the
 * platform (someone joining, an AI answer, an SMS, a reminder): allowed in
 * ACTIVE and TRIAL only.
 */
export function centerWorkRefusal(center: CenterRow, now = new Date(), rules: TrialRules = trialRules()): AccessRefusal | null {
  const state = centerState(center, now, rules);
  if (state === 'SUSPENDED') return refuse(center.suspendedReason === 'NON_PAYMENT' ? 'BILLING_SUSPENDED' : 'CENTER_SUSPENDED');
  if (state === 'LOCKED') return refuse('TRIAL_LOCKED');
  if (state === 'READ_ONLY') return refuse('TRIAL_READ_ONLY');
  return null;
}
