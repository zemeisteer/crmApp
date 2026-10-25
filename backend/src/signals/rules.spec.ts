import { describe, expect, it } from 'vitest';
import { absenceAlertDue, absenceRun, trialFollowUpDue } from './rules';

describe('absenceRun', () => {
  it('counts the absences since the last lesson attended, newest first or not', () => {
    const run = absenceRun([
      { date: '2026-10-01', status: 'PRESENT' },
      { date: '2026-10-08', status: 'ABSENT', groupId: 'g1' },
      { date: '2026-10-03', status: 'ABSENT', groupId: 'g1' },
      { date: '2026-10-06', status: 'ABSENT', groupId: 'g2' },
    ]);
    expect(run).toEqual({ count: 3, since: '2026-10-03', last: '2026-10-08', dates: ['2026-10-03', '2026-10-06', '2026-10-08'], groupIds: ['g1', 'g2'] });
  });

  it('a late arrival ends the run; a latest lesson attended means no run', () => {
    expect(absenceRun([{ date: '2026-10-01', status: 'ABSENT' }, { date: '2026-10-02', status: 'LATE' }])).toBeNull();
    expect(absenceRun([{ date: '2026-10-01', status: 'ABSENT' }, { date: '2026-10-02', status: 'LATE' }, { date: '2026-10-03', status: 'ABSENT' }])?.count).toBe(1);
    expect(absenceRun([])).toBeNull();
  });

  it('keeps naming a longer run by its first absence, so it alerts once', () => {
    const three = absenceRun([{ date: '2026-10-01', status: 'PRESENT' }, { date: '2026-10-02', status: 'ABSENT' }, { date: '2026-10-03', status: 'ABSENT' }, { date: '2026-10-04', status: 'ABSENT' }]);
    const four = absenceRun([{ date: '2026-10-01', status: 'PRESENT' }, { date: '2026-10-02', status: 'ABSENT' }, { date: '2026-10-03', status: 'ABSENT' }, { date: '2026-10-04', status: 'ABSENT' }, { date: '2026-10-05', status: 'ABSENT' }]);
    expect(three?.since).toBe(four?.since);
  });

  it('alerts from the threshold; 0 turns the rule off', () => {
    const run = absenceRun([{ date: '2026-10-02', status: 'ABSENT' }, { date: '2026-10-03', status: 'ABSENT' }]);
    expect(absenceAlertDue(run, 3)).toBe(false);
    expect(absenceAlertDue(run, 2)).toBe(true);
    expect(absenceAlertDue(run, 0)).toBe(false);
  });
});

describe('trialFollowUpDue', () => {
  const now = new Date('2026-10-20T10:00:00Z');
  const ago = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const base = { scheduledAt: ago(3), leadStatus: 'TRIAL_ATTENDED', lastContactAt: null, followUpAt: null };

  it('fires after the set days with no contact since the trial', () => {
    expect(trialFollowUpDue(base, 2, now)).toBe(true);
    expect(trialFollowUpDue(base, 4, now)).toBe(false); // not yet
    expect(trialFollowUpDue(base, 0, now)).toBe(false); // off
  });

  it('a contact after the trial, a later follow-up, or a decided lead stops it', () => {
    expect(trialFollowUpDue({ ...base, lastContactAt: ago(1) }, 2, now)).toBe(false);
    expect(trialFollowUpDue({ ...base, lastContactAt: ago(5) }, 2, now)).toBe(true); // contact before the trial
    expect(trialFollowUpDue({ ...base, followUpAt: new Date(now.getTime() + 3_600_000) }, 2, now)).toBe(false);
    expect(trialFollowUpDue({ ...base, leadStatus: 'ENROLLED' }, 2, now)).toBe(false);
    expect(trialFollowUpDue({ ...base, leadStatus: 'LOST' }, 2, now)).toBe(false);
  });

  it('leaves old trials alone when the rule is first switched on', () => {
    expect(trialFollowUpDue({ ...base, scheduledAt: ago(40) }, 2, now)).toBe(false);
  });
});
