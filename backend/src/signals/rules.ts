// The rules' arithmetic, kept apart from the database so it is tested alone.

export type Mark = { date: string; status: 'PRESENT' | 'ABSENT' | 'LATE' | string; groupId?: string };

/**
 * The absences in a row up to a student's latest lesson: the run of ABSENT
 * marks since the last lesson they came to (LATE counts as came). Several
 * marks on one day (two groups) are all counted. Null when the latest mark
 * is not an absence.
 *
 * `since` - the first absence of the run - names the run: a longer run of
 * the same absences keeps it, so a rule keyed on it fires once per run.
 */
export function absenceRun(marks: Mark[]): { count: number; since: string; last: string; dates: string[]; groupIds: string[] } | null {
  const sorted = [...marks].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const run: Mark[] = [];
  for (const m of sorted) {
    if (m.status !== 'ABSENT') break;
    run.push(m);
  }
  if (run.length === 0) return null;
  return {
    count: run.length,
    since: run[run.length - 1].date,
    last: run[0].date,
    dates: [...new Set(run.map((m) => m.date))].sort(),
    groupIds: [...new Set(run.map((m) => m.groupId).filter((g): g is string => Boolean(g)))],
  };
}

/** True when a run is long enough to tell the managers (threshold 0 = rule off). */
export function absenceAlertDue(run: ReturnType<typeof absenceRun>, threshold: number) {
  return threshold > 0 && run !== null && run.count >= threshold;
}

/**
 * A trial lesson that needs a follow-up: it took place (or was missed) at
 * least `days` days ago, not longer than `days + window` ago (old trials are
 * left alone when the rule is first switched on), the lead is still at the
 * trial stage, nobody has contacted them since, and no follow-up is planned
 * for later.
 */
export function trialFollowUpDue(
  t: { scheduledAt: Date; leadStatus: string; lastContactAt: Date | null; followUpAt: Date | null },
  days: number,
  now: Date,
  windowDays = 14,
): boolean {
  if (days <= 0) return false;
  const DAY = 86_400_000;
  const age = now.getTime() - t.scheduledAt.getTime();
  if (age < days * DAY || age > (days + windowDays) * DAY) return false;
  if (!['TRIAL_BOOKED', 'TRIAL_ATTENDED'].includes(t.leadStatus)) return false;
  if (t.lastContactAt && t.lastContactAt > t.scheduledAt) return false;
  if (t.followUpAt && t.followUpAt > now) return false;
  return true;
}
