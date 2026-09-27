import { describe, expect, it } from 'vitest';
import { ENGLISH_BANK, isCorrect, pickFromBank, suggestLevel, type PlacementQuestion } from './placement-bank';

describe('placement bank', () => {
  it('mixes question types and covers every level', () => {
    const qs = pickFromBank(ENGLISH_BANK, 12);
    expect(qs).toHaveLength(12);
    expect(new Set(qs.map((q) => q.type))).toEqual(new Set(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER']));
    expect(new Set(qs.map((q) => q.level))).toEqual(new Set([1, 2, 3]));
  });

  it('grades short answers leniently and choices by index', () => {
    const short: PlacementQuestion = { type: 'SHORT_ANSWER', prompt: 'x', options: [], answer: '6|x=6', level: 1 };
    expect(isCorrect(short, ' X=6 ')).toBe(true);
    expect(isCorrect(short, '6.')).toBe(true);
    expect(isCorrect(short, '7')).toBe(false);
    const mcq: PlacementQuestion = { type: 'MCQ', prompt: 'y', options: ['a', 'b'], correctIndex: 1, level: 1 };
    expect(isCorrect(mcq, '1')).toBe(true);
    expect(isCorrect(mcq, '')).toBe(false);
  });

  it('suggests a level from per-level results', () => {
    const q = (level: 1 | 2 | 3): PlacementQuestion => ({ type: 'MCQ', prompt: '', options: ['a', 'b'], correctIndex: 0, level });
    const qs = [q(1), q(1), q(2), q(2), q(3), q(3)];
    expect(suggestLevel(qs, ['0', '0', '0', '0', '0', '0'])).toBe(3);
    expect(suggestLevel(qs, ['0', '0', '0', '0', '1', '1'])).toBe(2);
    expect(suggestLevel(qs, ['0', '1', '1', '1', '1', '1'])).toBe(1);
  });
});
