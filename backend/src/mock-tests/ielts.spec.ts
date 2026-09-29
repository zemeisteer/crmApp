import { describe, expect, it } from 'vitest';
import { normalizeContent, overallBand, publicContent, rawToBand, roundBand, scoreObjective, writingBand, wordCount } from './ielts';
import { parseExaminerReply } from './examiner-prompts';
import { SAMPLE_IELTS } from './sample-test';

describe('IELTS scoring', () => {
  it('converts raw scores with the official tables', () => {
    expect(rawToBand('listening', 40, 40)).toBe(9);
    expect(rawToBand('listening', 30, 40)).toBe(7);
    expect(rawToBand('listening', 23, 40)).toBe(6);
    expect(rawToBand('reading', 30, 40)).toBe(7);
    expect(rawToBand('reading', 27, 40)).toBe(6.5);
    expect(rawToBand('reading', 0, 40)).toBe(0);
    // A 12-question mock is scaled to 40 first: 9/12 -> 30/40.
    expect(rawToBand('listening', 9, 12)).toBe(7);
  });

  it('rounds averages like IELTS does', () => {
    expect(roundBand(6.25)).toBe(6.5);
    expect(roundBand(6.75)).toBe(7);
    expect(roundBand(6.125)).toBe(6);
    expect(overallBand({ listening: 6.5, reading: 6.5, writing: 5, speaking: 7 })).toBe(6.5); // 6.25
    expect(overallBand({ listening: 6.5, reading: 6.5, writing: 5 })).toBeNull();
    expect(writingBand(6, 7)).toBe(6.5); // (6 + 14) / 3 = 6.67
    expect(writingBand(null, 6)).toBe(6);
  });

  it('scores the sample test and never shows keys to students', () => {
    const content = normalizeContent(SAMPLE_IELTS.content);
    expect(content.listening.parts.flatMap((p) => p.questions)).toHaveLength(12);
    expect(content.reading.passages[0].questions).toHaveLength(8);
    const res = scoreObjective(content, 'reading', { 0: 'true', 1: 'false', 2: 'false', 3: 'true', 4: 'ng', 5: 'Return', 6: 'wild', 7: 'B' });
    expect(res).toMatchObject({ raw: 8, max: 8, band: 9 });
    const lis = scoreObjective(content, 'listening', { 0: 'carter', 3: 'twenty five', 4: 'the fourth', 5: 'B' });
    expect(lis.raw).toBe(4);
    expect(lis.marks.slice(0, 6)).toEqual([true, false, false, true, true, true]);

    const pub = JSON.stringify(publicContent(content));
    expect(pub).not.toContain('correctAnswer');
    expect(publicContent(content).listening.parts[0].questions[0]).toMatchObject({ id: '0', no: 1 });
    expect(publicContent(content).reading.passages[0].questions[0]).toMatchObject({ id: '0', no: 1 });
  });

  it('drops broken questions and clamps settings', () => {
    const c = normalizeContent({ listening: { durationMin: 999, parts: [{ questions: [{ type: 'MCQ', prompt: 'x', options: ['a'] }, { type: 'FILL_BLANK', prompt: 'y', correctAnswer: 'z' }] }] } });
    expect(c.listening.durationMin).toBe(90);
    expect(c.listening.parts[0].questions).toHaveLength(1);
    expect(c.writing.tasks).toEqual([]);
  });

  it('counts words', () => {
    expect(wordCount("It's a well-known fact — 42 people agree.")).toBe(7);
    expect(wordCount('  ')).toBe(0);
  });
});

describe('examiner reply', () => {
  it('reads criteria and averages them to a half band', () => {
    const r = parseExaminerReply('Here: {"criteria":{"TR":6,"CC":6.5,"LR":6,"GRA":5.5},"strengths":["a"],"improvements":["b","c"],"summary":"ok","corrections":[{"original":"x","better":"y"}]}', ['TR', 'CC', 'LR', 'GRA']);
    expect(r).toMatchObject({ band: 6, criteria: { TR: 6, CC: 6.5, LR: 6, GRA: 5.5 }, strengths: ['a'], corrections: [{ original: 'x', better: 'y' }] });
  });

  it('rejects replies without the scores', () => {
    expect(parseExaminerReply('no json', ['FC'])).toBeNull();
    expect(parseExaminerReply('{"criteria":{"FC":6}}', ['FC', 'LR'])).toBeNull();
  });
});
