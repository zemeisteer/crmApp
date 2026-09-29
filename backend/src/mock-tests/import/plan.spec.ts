import { describe, expect, it } from 'vitest';
import { matchAudio, normalizePlan, pagesOf, parseAudioName, planFromLabels } from './plan';
import { levelOpen, missingKeys, normalizeContent, parseLevel, publicContent, rawToBand, scoreObjective } from '../ielts';

describe('book plan', () => {
  it('reads page ranges in any shape and keeps them inside the book', () => {
    expect(pagesOf('5-8, 10', 20)).toEqual([5, 6, 7, 8, 10]);
    expect(pagesOf([3, '1-2', 99], 20)).toEqual([1, 2, 3]);
    expect(pagesOf({ from: 18, to: 25 }, 20)).toEqual([18, 19, 20]);
    expect(pagesOf('', 20)).toEqual([]);
  });

  it('keeps tests that have a section and reads level and module', () => {
    const plan = normalizePlan({
      book: 'Cambridge IELTS 18', module: 'ACADEMIC',
      tests: [
        { title: 'Test 1', listening: '5-12', reading: '13-26', answerKey: [110], estimatedLevel: null },
        { title: 'Test 2', listening: '', estimatedLevel: 'B6' },
        { title: 'Test 3', writing: '40', estimatedLevel: 'B9' },
      ],
    }, 120);
    expect(plan.book).toBe('Cambridge IELTS 18');
    expect(plan.tests.map((t) => t.title)).toEqual(['Test 1', 'Test 3']);
    expect(plan.tests[0]).toMatchObject({ listening: [5, 6, 7, 8, 9, 10, 11, 12], answerKey: [110], level: null });
    expect(plan.tests[1].level).toBeNull();
  });

  it('groups labelled scanned pages by test', () => {
    const plan = planFromLabels([
      { page: 1, test: null, kind: 'other' },
      { page: 2, test: 1, kind: 'listening' },
      { page: 3, test: null, kind: 'listening' },
      { page: 4, test: 1, kind: 'reading' },
      { page: 5, test: 2, kind: 'Listening' },
      { page: 9, test: 1, kind: 'answerKey' },
    ], { book: 'Mock book' });
    expect(plan.tests).toHaveLength(2);
    expect(plan.tests[0]).toMatchObject({ title: 'Test 1', listening: [2, 3], reading: [4], answerKey: [9] });
    expect(plan.tests[1].listening).toEqual([5]);
  });
});

describe('audio matching', () => {
  it('reads test and part from common file names', () => {
    expect(parseAudioName('Test 2 Part 3.mp3')).toMatchObject({ test: 2, part: 3 });
    expect(parseAudioName('C18_T1_S4.mp3')).toMatchObject({ test: 1, part: 4 });
    expect(parseAudioName('IELTS18-test3-section1.mp3')).toMatchObject({ test: 3, part: 1 });
    expect(parseAudioName('Track 05.mp3')).toMatchObject({ test: null, part: null });
  });

  it('assigns named files, whole-section files and plain numbered tracks', () => {
    const named = matchAudio(['Test 1 Part 2.mp3', 'Test 1 Part 1.mp3', 'Test 2.mp3', 'bonus.mp3'], 2);
    expect(named.assignments[0].parts.slice(0, 2)).toEqual(['Test 1 Part 1.mp3', 'Test 1 Part 2.mp3']);
    expect(named.assignments[1].section).toBe('Test 2.mp3');
    expect(named.unmatched).toEqual(['bonus.mp3']);

    const tracks = matchAudio(Array.from({ length: 8 }, (_, i) => `Track ${String(i + 1).padStart(2, '0')}.mp3`), 2);
    expect(tracks.assignments[1].parts).toEqual(['Track 05.mp3', 'Track 06.mp3', 'Track 07.mp3', 'Track 08.mp3']);

    const one = matchAudio(['listening.mp3'], 1);
    expect(one.assignments[0].section).toBe('listening.mp3');
    expect(matchAudio(['18-2-3.mp3'], 4).assignments[1].parts[2]).toBe('18-2-3.mp3');
  });
});

describe('IELTS levels and real-exam scoring', () => {
  it('reads a group level from what centers write', () => {
    expect(parseLevel('6.5')).toBe('B6');
    expect(parseLevel('IELTS 7.0')).toBe('B7');
    expect(parseLevel('B1')).toBe('B5');
    expect(parseLevel('Upper-Intermediate')).toBe('B6');
    expect(parseLevel('Pre-Intermediate')).toBe('B5');
    expect(parseLevel('Beginner')).toBe('B4');
    expect(parseLevel('')).toBeNull();
  });

  it('opens the own level, one above and all below', () => {
    expect(levelOpen('B6', 'B5')).toBe(true);
    expect(levelOpen('B7', 'B5')).toBe(false);
    expect(levelOpen('B4', 'B7')).toBe(true);
    expect(levelOpen(null, 'B4')).toBe(true);
    expect(levelOpen('B8', null)).toBe(true);
  });

  it('counts "choose TWO" as two numbered marks and uses the GT table', () => {
    const content = normalizeContent({
      reading: {
        passages: [{
          title: 'P', text: 'T', questions: [
            { type: 'MCQ_MULTI', prompt: 'Which TWO?', options: ['a', 'b', 'c', 'd', 'e'], correctAnswer: 'A,C' },
            { type: 'FILL_BLANK', prompt: 'x ______', correctAnswer: 'y' },
            { type: 'FILL_BLANK', prompt: 'no key ______', correctAnswer: '' },
          ],
        }],
      },
    });
    expect(missingKeys(content)).toBe(1);
    const pub = publicContent(content).reading.passages[0].questions;
    expect(pub.map((q) => [q.no, q.span])).toEqual([[1, 2], [3, 1], [4, 1]]);
    const r = scoreObjective(content, 'reading', { 0: 'C,A', 1: 'y' });
    expect(r).toMatchObject({ raw: 3, max: 4 });
    expect(rawToBand('reading', 30, 40, 'GENERAL')).toBe(6);
    expect(rawToBand('reading', 30, 40, 'ACADEMIC')).toBe(7);
  });
});
