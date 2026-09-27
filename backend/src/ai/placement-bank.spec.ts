import { describe, expect, it } from 'vitest';
import { ENGLISH_BANK, pickFromBank } from './placement-bank';
import { gradeAnswer, normalizeQuestion, suggestLevel, type TestQuestion } from '../common/test-questions';

describe('placement bank', () => {
  it('mixes question types and covers every level', () => {
    const qs = pickFromBank(ENGLISH_BANK, 12);
    expect(qs).toHaveLength(12);
    expect(new Set(qs.map((q) => q.type))).toEqual(new Set(['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER']));
    expect(new Set(qs.map((q) => q.level))).toEqual(new Set([1, 2, 3]));
  });

  it('turns bank questions into gradable test questions', () => {
    const qs = pickFromBank(ENGLISH_BANK, 12).map((q) => normalizeQuestion({ ...q, correctAnswer: q.answer }));
    expect(qs.every((q) => q !== null)).toBe(true);
    const mcq = qs.find((q) => q!.type === 'MCQ')!;
    expect(gradeAnswer(mcq, mcq.correctAnswer).correct).toBe(true);
  });

  it('suggests a level from per-level results', () => {
    const q = (level: 1 | 2 | 3): TestQuestion => ({ type: 'MCQ', prompt: 'x', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], correctAnswer: 'A', points: 1, level });
    const qs = [q(1), q(1), q(2), q(2), q(3), q(3)];
    const grade = (answers: string[]) => qs.map((x, i) => gradeAnswer(x, answers[i]));
    expect(suggestLevel(qs, grade(['A', 'A', 'A', 'A', 'A', 'A']))).toBe(3);
    expect(suggestLevel(qs, grade(['A', 'A', 'A', 'A', 'B', 'B']))).toBe(2);
    expect(suggestLevel(qs, grade(['A', 'B', 'B', 'B', 'B', 'B']))).toBe(1);
  });
});
