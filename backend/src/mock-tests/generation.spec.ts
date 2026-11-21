import { describe, expect, it, vi } from 'vitest';
import {
  applyResults,
  checkListeningPart,
  checkSpeaking,
  checkWriting,
  cueCardPoints,
  emptyMeta,
  parseReply,
  PART_KEYS,
  partsWithoutAudio,
  pool,
  publishBlocker,
  runPart,
  slotComplete,
  specFor,
  type TextAi,
  type Topics,
} from './generation';
import { normalizeContent, sectionQuestions, marksOf } from './ielts';

// Synthetic AI replies (no real AI is called): a complete part of each kind.
const sentence =
  'The guide explains that the old station was rebuilt as a public library in the spring. ';
const text = (wordsWanted: number) =>
  sentence.repeat(Math.ceil(wordsWanted / 16)).trim();
const fill = (no: number) => ({
  no,
  type: 'FILL_BLANK',
  prompt: `Item ${no}: ______`,
  correctAnswer: 'library',
  explanation: 'Said in the talk.',
});
const multi = (no: number) => ({
  no,
  type: 'MCQ_MULTI',
  prompt: 'Which TWO are true?',
  correctAnswer: 'A,C',
  explanation: 'Both stated.',
  options: [
    { id: 'A', text: 'one' },
    { id: 'B', text: 'two' },
    { id: 'C', text: 'three' },
    { id: 'D', text: 'four' },
  ],
});
const range = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => from + i);

const listening = (from: number, marks = 10) => ({
  title: 'Part',
  instruction: null,
  transcript: `Anna: ${text(150)}\nTom: ${text(150)}`,
  // 8 single questions + one "choose TWO" = 10 marks in 9 objects.
  questions:
    marks === 10
      ? [...range(from, 8).map(fill), multi(from + 8)]
      : range(from, marks).map(fill),
});
const reading = (from: number, n: number) => ({
  title: 'Passage',
  text: text(600),
  questions: range(from, n).map(fill),
});
const writing = {
  tasks: [
    {
      title: 'Task 1',
      prompt: `The chart shows energy use in three countries.\n[Chart]\n${text(60)}`,
      minWords: 150,
    },
    {
      title: 'Task 2',
      prompt:
        'Some people think schools should teach money skills. To what extent do you agree or disagree? Write at least 250 words.',
      minWords: 250,
    },
  ],
};
const cueCard =
  'Describe a place you visited that you liked.\nYou should say:\n- where it is\n- when you went there\n- what you did there\nand explain why you liked it.';
const speaking = {
  parts: [
    { title: 'Part 1', questions: range(1, 9).map((i) => `Question ${i}?`) },
    { title: 'Part 2', questions: [cueCard] },
    { title: 'Part 3', questions: range(1, 5).map((i) => `Why ${i}?`) },
  ],
};

const topics: Topics = {
  listening: ['a', 'b', 'c', 'd'],
  reading: ['x', 'y', 'z'],
  writing: { task1: 'energy chart', task2: 'money skills' },
  speaking: {
    part1: ['home', 'work', 'free time'],
    part2: 'a place',
    part3: 'travel',
  },
};

// A fake AI that answers each prompt with the matching complete part; tests
// override it per prompt with `replies`.
function fakeAi(overrides: Array<{ match: RegExp; replies: string[] }> = []) {
  const calls: string[] = [];
  const ai: TextAi = {
    completeText: vi.fn(async (prompt: string) => {
      calls.push(prompt);
      for (const o of overrides)
        if (o.match.test(prompt) && o.replies.length) return o.replies.shift()!;
      const lp = prompt.match(/Write Part (\d) of an original IELTS Listening/);
      if (lp)
        return JSON.stringify(listening([1, 11, 21, 31][Number(lp[1]) - 1]));
      const rp = prompt.match(/Write Passage (\d)/);
      if (rp)
        return JSON.stringify(
          reading(
            [1, 14, 27][Number(rp[1]) - 1],
            [13, 13, 14][Number(rp[1]) - 1],
          ),
        );
      if (/Writing section/.test(prompt))
        return '```json\n' + JSON.stringify(writing) + '\n```';
      if (/Speaking section/.test(prompt)) return JSON.stringify(speaking);
      return '';
    }),
  };
  return { ai, calls };
}

async function generate(ai: TextAi, module = 'ACADEMIC') {
  const results = await pool(
    PART_KEYS.map((k) => () => runPart(ai, specFor(k, topics, 'B6', module))),
  );
  return {
    results,
    content: applyResults(
      normalizeContent({ generation: emptyMeta() }),
      results,
    ),
  };
}

const marks = (
  c: ReturnType<typeof normalizeContent>,
  s: 'listening' | 'reading',
) => sectionQuestions(c, s).reduce((n, q) => n + marksOf(q), 0);

describe('AI mock generation: full output', () => {
  it('builds a complete test: Listening 40, Reading 40, two Writing tasks, three Speaking parts', async () => {
    const { ai } = fakeAi();
    const { content, results } = await generate(ai);
    expect(results.every((r) => r.ok && r.attempts === 1)).toBe(true);
    expect(content.listening.parts).toHaveLength(4);
    expect(marks(content, 'listening')).toBe(40);
    // 9 question objects per part: the "choose TWO" one is two marks.
    expect(sectionQuestions(content, 'listening')).toHaveLength(36);
    expect(
      content.listening.parts.every(
        (p) => p.transcript && p.transcript.includes('Anna:'),
      ),
    ).toBe(true);
    expect(content.reading.passages).toHaveLength(3);
    expect(marks(content, 'reading')).toBe(40);
    expect(content.reading.passages.every((p) => p.text.length > 0)).toBe(true);
    expect(content.writing.tasks.map((t) => t.title)).toEqual([
      'Task 1',
      'Task 2',
    ]);
    expect(content.writing.tasks[0].prompt).toContain('[Chart]');
    expect(content.speaking.parts.map((p) => p.questions.length)).toEqual([
      9, 1, 5,
    ]);
    expect(content.speaking.parts[1].prepSeconds).toBe(60);
    expect(content.generation?.failed).toEqual([]);
    // No audio yet: an AI test may not be published until it has some.
    expect(partsWithoutAudio(content)).toEqual([0, 1, 2, 3]);
    expect(publishBlocker(content)).toMatch(/audio kerak/);
    content.listening.parts.forEach((p, i) => {
      p.audioPath = `audio${i}abcdef.wav`;
    });
    expect(publishBlocker(content)).toBeNull();
  });

  it('reads replies with raw line breaks inside strings (a passage in paragraphs)', () => {
    const raw = `{"title": "T", "text": "A First paragraph.\n\nB Second paragraph.", "questions": []}`;
    expect(parseReply(raw)).toEqual({
      data: {
        title: 'T',
        text: 'A First paragraph.\n\nB Second paragraph.',
        questions: [],
      },
      truncated: false,
    });
  });
});

describe('AI mock generation: truncated output', () => {
  const full = JSON.stringify(reading(14, 13));
  const cut = full.slice(0, Math.floor(full.length * 0.6));

  it('notices a reply cut off at the token limit', () => {
    expect(parseReply(cut)).toEqual({ data: null, truncated: true });
    expect(parseReply('Sorry, I cannot help.')).toEqual({
      data: null,
      truncated: false,
    });
  });

  it('asks again (telling the model it was cut off) and keeps the complete reply', async () => {
    const { ai, calls } = fakeAi([
      { match: /Write Passage 2/, replies: [cut] },
    ]);
    const r = await runPart(ai, specFor('reading.1', topics, null, 'ACADEMIC'));
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[1]).toMatch(/cut off/);
  });

  it('a part that stays cut off is recorded as failed with an empty slot, not dropped, and blocks publishing', async () => {
    const { ai } = fakeAi([
      { match: /Write Passage 2/, replies: [cut, cut, cut] },
    ]);
    const { content } = await generate(ai);
    expect(content.reading.passages).toHaveLength(3);
    expect(content.reading.passages[1]).toMatchObject({
      title: 'Passage 2',
      text: '',
      questions: [],
    });
    expect(marks(content, 'reading')).toBe(27);
    expect(content.generation?.failed).toEqual([
      {
        key: 'reading.1',
        label: 'Reading Passage 2',
        error: 'the reply was cut off before the end',
      },
    ]);
    content.listening.parts.forEach((p, i) => {
      p.audioPath = `audio${i}abcdef.wav`;
    });
    expect(publishBlocker(content)).toMatch(/Reading Passage 2 yaratilmadi/);
  });

  it('a short reply (9 of 10 Listening questions) is rejected and asked for again', async () => {
    expect(checkListeningPart(listening(1, 9), 0)).toEqual({
      ok: false,
      reason: '9 questions instead of 10',
    });
    const { ai, calls } = fakeAi([
      { match: /Write Part 4 of/, replies: [JSON.stringify(listening(31, 9))] },
    ]);
    const r = await runPart(
      ai,
      specFor('listening.3', topics, null, 'ACADEMIC'),
    );
    expect(r).toMatchObject({ ok: true, attempts: 2 });
    expect(calls[1]).toContain('9 questions instead of 10');
  });
});

describe('AI mock generation: one failing section retried', () => {
  it('a Speaking section with an incomplete cue card is retried and then complete', async () => {
    const broken = JSON.stringify({
      parts: [
        speaking.parts[0],
        { title: 'Part 2', questions: ['Describe a place you visited.'] },
      ],
    });
    const { ai, calls } = fakeAi([
      { match: /Speaking section/, replies: [broken] },
    ]);
    const { content, results } = await generate(ai);
    expect(results.find((r) => r.key === 'speaking')).toMatchObject({
      ok: true,
      attempts: 2,
    });
    expect(calls.filter((p) => /Speaking section/.test(p))).toHaveLength(2);
    expect(
      calls.find(
        (p) =>
          /Speaking section/.test(p) &&
          /rejected: 2 parts instead of 3/.test(p),
      ),
    ).toBeTruthy();
    expect(content.speaking.parts).toHaveLength(3);
    expect(content.generation?.failed).toEqual([]);
  });

  it('a busy AI for one part is retried; other parts are not affected', async () => {
    let n = 0;
    const { ai: base } = fakeAi();
    const ai: TextAi = {
      completeText: async (p, t) => {
        if (/Writing section/.test(p) && n++ === 0)
          throw new Error('AI xizmati hozir band');
        return base.completeText(p, t);
      },
    };
    const { results } = await generate(ai);
    expect(results.find((r) => r.key === 'writing')).toMatchObject({
      ok: true,
      attempts: 2,
    });
    expect(results.filter((r) => r.attempts > 1)).toHaveLength(1);
  });

  it('retrying one failed part fills its slot and clears the failure, keeping the other parts', async () => {
    const { ai } = fakeAi([
      { match: /Writing section/, replies: ['{}', '{}', '{}'] },
    ]);
    const first = await generate(ai);
    expect(first.content.generation?.failed.map((f) => f.key)).toEqual([
      'writing',
    ]);
    expect(first.content.writing.tasks).toEqual([]);
    const again = await runPart(
      fakeAi().ai,
      specFor('writing', topics, null, 'ACADEMIC'),
    );
    const after = applyResults(first.content, [again]);
    expect(after.generation?.failed).toEqual([]);
    expect(after.writing.tasks).toHaveLength(2);
    expect(after.reading.passages).toEqual(first.content.reading.passages);
  });

  it('a failed part filled in by the teacher counts as complete', async () => {
    const { ai } = fakeAi([
      { match: /Write Passage 1/, replies: ['x', 'x', 'x'] },
    ]);
    const { content } = await generate(ai);
    expect(slotComplete(content, 'reading.0', 'ACADEMIC')).toBe(false);
    content.reading.passages[0] = normalizeContent({
      reading: { passages: [reading(1, 13)] },
    }).reading.passages[0];
    expect(slotComplete(content, 'reading.0', 'ACADEMIC')).toBe(true);
  });
});

describe('AI mock generation: part checks', () => {
  it('Writing: Academic Task 1 needs a [Chart] description', () => {
    expect(
      checkWriting(
        { tasks: [{ prompt: 'Describe the chart.' }, writing.tasks[1]] },
        'ACADEMIC',
      ),
    ).toMatchObject({ ok: false });
    expect(checkWriting(writing, 'ACADEMIC')).toMatchObject({ ok: true });
    expect(checkWriting({ tasks: [writing.tasks[0]] }, 'ACADEMIC')).toEqual({
      ok: false,
      reason: '1 tasks instead of 2',
    });
  });

  it('Speaking: a cue card sent as several lines is joined into one card', () => {
    const lines = cueCard.split('\n');
    const r = checkSpeaking({
      parts: [speaking.parts[0], { questions: lines }, speaking.parts[2]],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value[1].questions).toEqual([cueCard]);
    expect(cueCardPoints(cueCard)).toBe(3);
    expect(
      cueCardPoints(
        'Describe a trip. You should say: where, when and explain why.',
      ),
    ).toBeLessThan(3);
  });
});
