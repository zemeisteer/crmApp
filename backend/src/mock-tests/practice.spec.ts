import { describe, expect, it } from 'vitest';
import { normalizePractice, practiceKeys, practiceMissingKeys, practiceOverall, practiceTemplate, publicPractice, scorePracticeSection, sectionIndex, templateFor } from './practice';

const content = () =>
  normalizePractice({
    sections: [
      {
        title: 'Math',
        durationMin: 15,
        parts: [
          {
            title: 'Part 1',
            questions: [
              { type: 'SHORT_ANSWER', prompt: '2 + 3 = ?', correctAnswer: '5|five' },
              { type: 'MCQ', prompt: 'x^2 = 9, x > 0', options: ['2', '3', '4'], correctAnswer: 'B' },
              { type: 'MATCHING', prompt: 'Match', pairs: [{ left: '1/2', right: '0.5' }, { left: '1/4', right: '0.25' }], extra: ['0.75'] },
            ],
          },
        ],
        tasks: [],
      },
      { title: 'Writing', durationMin: 20, parts: [], tasks: [{ title: 'Essay', prompt: 'Why is math useful?', minWords: 50 }] },
      { title: 'Broken', parts: [{ questions: [{ type: 'ESSAY', prompt: 'x' }] }], tasks: [{ prompt: '' }] },
    ],
  });

describe('practice tests', () => {
  it('cleans content and numbers questions through a section without keys', () => {
    const c = content();
    expect(c.sections).toHaveLength(3);
    expect(c.sections[2].parts[0].questions).toEqual([]); // no essays among questions
    expect(c.sections[2].tasks).toEqual([]); // a task needs a prompt
    expect(c.sections[1].durationMin).toBe(20);
    const pub = publicPractice(c);
    expect(JSON.stringify(pub)).not.toContain('correctAnswer');
    expect(pub.sections[0].parts[0].questions.map((q) => [q.id, q.no, q.span])).toEqual([['0', 1, 1], ['1', 2, 1], ['2', 3, 2]]);
    expect(pub.sections[0].key).toBe('s0');
    expect(sectionIndex('s1', c)).toBe(1);
    expect(sectionIndex('s9', c)).toBeNull();
    expect(sectionIndex('listening', c)).toBeNull();
    expect(practiceMissingKeys(c)).toBe(0);
  });

  it('scores questions at once and waits for the writing tasks', () => {
    const c = content();
    const math = scorePracticeSection(c.sections[0], { 0: 'five', 1: 'B', 2: JSON.stringify({ 0: '0.5', 1: '0.75' }) });
    expect(math).toMatchObject({ status: 'DONE', raw: 3, max: 4, percent: 75, marks: [true, true, false] });
    const writing = scorePracticeSection(c.sections[1], { t0: 'Math helps us every day.' });
    expect(writing).toMatchObject({ status: 'REVIEW', percent: null, max: 10, tasks: [{ score: null, words: 5 }] });
    const graded = scorePracticeSection(c.sections[1], {}, [{ score: 7, words: 60, comment: 'ok' }]);
    expect(graded).toMatchObject({ status: 'DONE', raw: 7, max: 10, percent: 70 });
    expect(practiceOverall([math, writing])).toBeNull();
    expect(practiceOverall([math, graded])).toBe(71); // 10 / 14
    expect(practiceKeys(c.sections[0])).toEqual(['5', '3', '1/2 → 0.5; 1/4 → 0.25']);
  });

  it('picks a starting layout for the direction', () => {
    expect(templateFor('SAT Math')).toBe('SAT');
    expect(templateFor('Matematika')).toBe('MATH');
    expect(templateFor('Python dasturlash')).toBe('PROGRAMMING');
    expect(templateFor('Ingliz tili (General)')).toBe('ENGLISH');
    expect(templateFor('Kimyo')).toBe('GENERAL');
    const sat = practiceTemplate('SAT');
    expect(sat.content.sections.map((s) => s.durationMin)).toEqual([32, 32, 35, 35]);
  });
});
