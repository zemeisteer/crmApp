import { describe, expect, it } from 'vitest';
import { allowedTransitions, canTransition, dedicatedFlowFor, isTerminal, LEAD_STATUSES, REOPEN_TARGET } from './lead-lifecycle';

describe('lead lifecycle policy', () => {
  const legal: [string, string][] = [
    ['NEW', 'CONTACTED'],
    ['CONTACTED', 'TRIAL_BOOKED'],
    ['CONTACTED', 'QUALIFIED'],
    ['CONTACTED', 'LOST'],
    ['TRIAL_BOOKED', 'TRIAL_ATTENDED'],
    ['TRIAL_BOOKED', 'LOST'],
    ['TRIAL_ATTENDED', 'QUALIFIED'],
    ['TRIAL_ATTENDED', 'LOST'],
    ['QUALIFIED', 'ENROLLED'],
    ['QUALIFIED', 'LOST'],
  ];

  it('allows exactly the specified transitions', () => {
    for (const from of LEAD_STATUSES) {
      for (const to of LEAD_STATUSES) {
        const expected = legal.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('rejects skipping stages', () => {
    expect(canTransition('NEW', 'ENROLLED')).toBe(false);
    expect(canTransition('NEW', 'QUALIFIED')).toBe(false);
    expect(canTransition('CONTACTED', 'ENROLLED')).toBe(false);
    expect(canTransition('NEW', 'LOST')).toBe(false);
  });

  it('treats ENROLLED as terminal and LOST as closed except via reopen', () => {
    expect(isTerminal('ENROLLED')).toBe(true);
    expect(allowedTransitions('ENROLLED')).toEqual([]);
    expect(allowedTransitions('LOST')).toEqual([]);
    expect(REOPEN_TARGET).toBe('CONTACTED');
  });

  it('routes side-effecting stages through dedicated flows', () => {
    expect(dedicatedFlowFor('TRIAL_BOOKED')).toContain('/trials');
    expect(dedicatedFlowFor('ENROLLED')).toContain('/convert');
    expect(dedicatedFlowFor('LOST')).toContain('/lose');
    expect(dedicatedFlowFor('CONTACTED')).toBeUndefined();
    expect(dedicatedFlowFor('QUALIFIED')).toBeUndefined();
  });
});
