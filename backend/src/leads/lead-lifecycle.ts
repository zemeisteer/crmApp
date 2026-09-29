// The single source of truth for which lead stage moves are legal. Every
// status change (manual moves, trial outcomes, conversion, loss, reopen) is
// checked here so no code path can put a lead into an unreachable state.

export const LEAD_STATUSES = [
  'NEW',
  'CONTACTED',
  'TRIAL_BOOKED',
  'TRIAL_ATTENDED',
  'QUALIFIED',
  'ENROLLED',
  'LOST',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_SOURCES = [
  'INSTAGRAM',
  'TELEGRAM',
  'WEBSITE',
  'REFERRAL',
  'WALK_IN',
  'PHONE',
  'ADVERTISEMENT',
  'OTHER',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_LOST_REASONS = [
  'TOO_EXPENSIVE',
  'NO_RESPONSE',
  'CHOSE_COMPETITOR',
  'SCHEDULE_MISMATCH',
  'LOCATION',
  'NOT_INTERESTED',
  'OTHER',
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];

const TRANSITIONS: Record<LeadStatus, readonly LeadStatus[]> = {
  NEW: ['CONTACTED'],
  // Contacted leads go through a trial lesson before they are qualified.
  // The one exception is a lead who already took the level test (see
  // TransitionContext): the test result stands in for the trial.
  CONTACTED: ['TRIAL_BOOKED', 'LOST'],
  TRIAL_BOOKED: ['TRIAL_ATTENDED', 'LOST'],
  TRIAL_ATTENDED: ['QUALIFIED', 'LOST'],
  QUALIFIED: ['ENROLLED', 'LOST'],
  ENROLLED: [],
  // Reopening is a separate, permissioned action (see REOPEN_TARGET) rather
  // than an ordinary move, so it is not listed here.
  LOST: [],
};

// A reopened lead restarts at CONTACTED: it was contacted before it was lost,
// and restarting at NEW would make "new leads" counts double-count it.
export const REOPEN_TARGET: LeadStatus = 'CONTACTED';

// Stages that must go through a dedicated flow instead of a plain move,
// because they need extra data or side effects.
const DEDICATED_FLOW: Partial<Record<LeadStatus, string>> = {
  TRIAL_BOOKED: 'POST /leads/:id/trials',
  TRIAL_ATTENDED: 'POST /leads/:id/trials/:trialId/attend',
  ENROLLED: 'POST /leads/:id/convert',
  LOST: 'POST /leads/:id/lose',
};

// Facts about the lead that unlock an otherwise closed move.
export interface TransitionContext {
  // The lead finished a placement (level) test.
  tookPlacementTest?: boolean;
}

export function allowedTransitions(from: LeadStatus, ctx: TransitionContext = {}): readonly LeadStatus[] {
  const base = TRANSITIONS[from] ?? [];
  if (from === 'CONTACTED' && ctx.tookPlacementTest) return [...base, 'QUALIFIED'];
  return base;
}

export function canTransition(from: LeadStatus, to: LeadStatus, ctx: TransitionContext = {}): boolean {
  return allowedTransitions(from, ctx).includes(to);
}

export function dedicatedFlowFor(to: LeadStatus): string | undefined {
  return DEDICATED_FLOW[to];
}

export function isTerminal(status: LeadStatus): boolean {
  return status === 'ENROLLED';
}

// Funnel order used for historical "reached stage" metrics.
export const FUNNEL_STAGES: readonly LeadStatus[] = [
  'NEW',
  'CONTACTED',
  'TRIAL_BOOKED',
  'TRIAL_ATTENDED',
  'QUALIFIED',
  'ENROLLED',
];
