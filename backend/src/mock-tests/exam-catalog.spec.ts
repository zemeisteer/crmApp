import { describe, expect, it } from 'vitest';
import { EXAMS, examsFor, languagesFor } from './exam-catalog';
import {
  emptySpecParts,
  examTemplate,
  normalizePractice,
  publicPractice,
} from './practice';
import { fillPrompt, parseFill, MockFillService } from './mock-fill';
import type { AiService } from '../ai/ai.service';

describe('exam catalog', () => {
  it('lists the exams of a direction first', () => {
    expect(languagesFor('Ingliz tili')).toEqual(['ENGLISH']);
    expect(languagesFor('Rus tili')).toEqual(['RUSSIAN']);
    expect(languagesFor('SAT Math')).toEqual(['SAT', 'MATH']);
    expect(examsFor('Ingliz tili').fit.map((e) => e.id)).toEqual([
      'IELTS',
      'CEFR_EN',
      'GENERAL_EN',
    ]);
    expect(examsFor('Rus tili').fit.map((e) => e.id)).toEqual([
      'CEFR_RU',
      'TRKI',
    ]);
    expect(examsFor('Koreys tili').fit.map((e) => e.id)).toEqual(['TOPIK']);
    const all = examsFor('Rus tili');
    expect(all.fit.length + all.other.length).toBe(EXAMS.length);
  });

  it('every exam but IELTS has sections, levels and parts with a question count', () => {
    for (const e of EXAMS.filter((x) => !x.ielts)) {
      expect(e.levels.length).toBeGreaterThan(0);
      expect(e.sections.length).toBeGreaterThan(0);
      for (const s of e.sections) {
        expect(s.parts.length + (s.task ? 1 : 0)).toBeGreaterThan(0);
        for (const p of s.parts) expect(p.count).toBeGreaterThan(0);
      }
    }
  });

  it('a test made from an exam keeps its structure, level and the parts to fill', () => {
    const tpl = examTemplate('SAT', '1200–1400')!;
    expect(tpl.title).toBe('Digital SAT · 1200–1400');
    expect(tpl.content.exam).toEqual({ id: 'SAT', level: '1200–1400' });
    expect(tpl.content.sections.map((s) => s.durationMin)).toEqual([
      32, 32, 35, 35,
    ]);
    expect(emptySpecParts(tpl.content)).toHaveLength(14);
    // Survives a save and is not sent to students.
    const again = normalizePractice(JSON.parse(JSON.stringify(tpl.content)));
    expect(again.sections[2].parts[2].spec).toMatchObject({
      type: 'SHORT_ANSWER',
      count: 5,
    });
    expect(JSON.stringify(publicPractice(again))).not.toContain('spec');
    // An unknown level is dropped; IELTS and unknown exams have no template.
    expect(examTemplate('TRKI', 'Z9')!.content.exam?.level).toBeNull();
    expect(examTemplate('IELTS', 'B6')).toBeNull();
    expect(examTemplate('NOPE', null)).toBeNull();
  });
});

describe('filling a test from its exam', () => {
  const tpl = () => examTemplate('CEFR_RU', 'B1')!.content;

  it('asks for the part type, count, level and language', () => {
    const c = tpl();
    const prompt = fillPrompt({
      exam: 'CEFR',
      target: 'Russian',
      level: 'B1',
      section: c.sections[0].title,
      part: c.sections[0].parts[0],
    });
    expect(prompt).toContain('TRUE_FALSE_NG');
    expect(prompt).toContain('Number of questions: 8');
    expect(prompt).toContain('level B1');
    expect(prompt).toContain('in Russian');
  });

  it('reads a reply: forces the type, keeps the text, caps the count', () => {
    const part = tpl().sections[0].parts[1]; // MCQ x8 with a text
    const reply = JSON.stringify({
      text: 'Текст о Москве.',
      questions: Array.from({ length: 10 }, (_, i) => ({
        type: 'SHORT_ANSWER',
        prompt: `Вопрос ${i}`,
        options: ['a', 'b', 'c', 'd'],
        correctAnswer: 'B',
      })),
    });
    const got = parseFill(reply, part)!;
    expect(got.text).toBe('Текст о Москве.');
    expect(got.questions).toHaveLength(8);
    expect(got.questions.every((q) => q.type === 'MCQ')).toBe(true);
    expect(parseFill('no json here', part)).toBeNull();
  });

  it('fills every empty part in parallel and leaves filled ones alone', async () => {
    const c = tpl();
    c.sections[1].parts[0].questions = [
      {
        type: 'MCQ',
        prompt: 'own',
        options: [
          { id: 'A', text: 'x' },
          { id: 'B', text: 'y' },
        ],
        correctAnswer: 'A',
        points: 1,
      } as never,
    ];
    let calls = 0;
    const ai = {
      completeText: async (prompt: string) => {
        calls++;
        const type = /Question type: (\w+)/.exec(prompt)![1];
        return JSON.stringify({
          text: 'T',
          questions: [
            {
              type,
              prompt: 'Q _____',
              options: ['1', '2', '3', '4'],
              correctAnswer:
                type === 'MCQ'
                  ? 'A'
                  : type === 'TRUE_FALSE_NG'
                    ? 'ng'
                    : 'слово',
            },
          ],
        });
      },
    } as unknown as AiService;
    const svc = new MockFillService({} as never, ai);
    const { content, failed } = await svc.fillContent(c);
    expect(failed).toBe(0);
    expect(calls).toBe(4); // 3 reading parts + word formation; grammar was filled by hand
    expect(content.sections[1].parts[0].questions[0].prompt).toBe('own');
    expect(emptySpecParts(content)).toHaveLength(0);
    expect(content.sections[0].parts[0].text).toBe('T');
  });
});
