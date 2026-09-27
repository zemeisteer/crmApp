import { describe, expect, it } from 'vitest';
import { acceptedAnswers, gradeAnswer, normalizeQuestion, publicQuestion, type TestQuestion } from './test-questions';

describe('test questions', () => {
  it('reads multiple choice answers written in different ways', () => {
    const opts = ['lives', 'is living', 'has lived', 'lived'];
    for (const answer of ['C', 'c', 'C) has lived', 'has lived']) {
      expect(normalizeQuestion({ type: 'MCQ', prompt: 'She ___ here since 2019.', options: opts, correctAnswer: answer })?.correctAnswer).toBe('C');
    }
    expect(normalizeQuestion({ type: 'MCQ', prompt: 'x', options: opts, correctAnswer: '' })).toBeNull();
    expect(normalizeQuestion({ type: 'MCQ', prompt: 'x', options: opts, correctAnswer: '' }, { requireAnswer: false })?.correctAnswer).toBe('');
  });

  it('understands true / false / not given keys', () => {
    expect(normalizeQuestion({ type: 'TRUE_FALSE_NG', prompt: 'x', correctAnswer: 'NG' })).toMatchObject({ correctAnswer: 'ng', options: [{ id: 'true' }, { id: 'false' }, { id: 'ng' }] });
    expect(normalizeQuestion({ type: 'TRUE_FALSE', prompt: 'x', correctAnswer: 'F' })?.correctAnswer).toBe('false');
  });

  it('accepts optional words and alternatives in text answers', () => {
    expect(acceptedAnswers('(the) Ulugh Beg Madrasa')).toEqual(['ulugh beg madrasa', 'the ulugh beg madrasa']);
    const q = normalizeQuestion({ type: 'SHORT_ANSWER', prompt: 'Which madrasa?', correctAnswer: '(the) Ulugh Beg Madrasa' }) as TestQuestion;
    expect(gradeAnswer(q, 'The Ulugh Beg madrasa.').correct).toBe(true);
    expect(gradeAnswer(q, 'Ulugh Beg Madrasa').correct).toBe(true);
    expect(gradeAnswer(q, 'Registan').correct).toBe(false);
    const wo = normalizeQuestion({ type: 'WORD_ORDER', prompt: 'ever / you / have / been / to / London / ?', correctAnswer: 'Have you ever been to London?' }) as TestQuestion;
    expect(wo.words).toContain('London');
    expect(gradeAnswer(wo, 'have you ever been to london').correct).toBe(true);
  });

  it('gives partial points for matching and leaves essays to the teacher', () => {
    const m = normalizeQuestion({
      type: 'MATCHING', prompt: 'Match', points: 4,
      pairs: [{ left: 'reluctant', right: 'not wanting to do something' }, { left: 'reliable', right: 'able to be trusted' },
        { left: 'postpone', right: 'to delay doing something' }, { left: 'enormous', right: 'extremely large' }],
    }) as TestQuestion;
    const answer = JSON.stringify({ 0: 'not wanting to do something', 1: 'able to be trusted', 2: 'extremely large', 3: 'to delay doing something' });
    expect(gradeAnswer(m, answer)).toMatchObject({ earned: 2, max: 4, correct: false });
    const view = publicQuestion(m) as { left: string[]; right: string[] };
    expect(view.left).toHaveLength(4);
    expect([...view.right].sort()).toEqual(m.pairs!.map((p) => p.right).sort());
    expect(JSON.stringify(publicQuestion(normalizeQuestion({ type: 'MCQ', prompt: 'x', options: ['a', 'b'], correctAnswer: 'B' }) as TestQuestion))).not.toContain('correctAnswer');

    const essay = normalizeQuestion({ type: 'ESSAY', prompt: 'Write an email', points: 8, rubric: 'content 3, format 2, language 3' }) as TestQuestion;
    expect(gradeAnswer(essay, 'Dear friend...')).toMatchObject({ pending: true, earned: 0, max: 8 });
  });
});
