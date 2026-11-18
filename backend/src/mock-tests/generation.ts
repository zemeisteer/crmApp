import { parseLooseJson } from '../ai/test-prompts';
import {
  marksOf,
  normalizeContent,
  type GenerationMeta,
  type GenerationPlan,
  type ListeningPart,
  type MockContent,
  type ReadingPassage,
  type SpeakingPart,
  type WritingTask,
} from './ielts';
import {
  listeningPartPrompt,
  readingPassagePrompt,
  speakingGenPrompt,
  writingGenPrompt,
} from './generate-prompts';

// Writing an AI mock test part by part: each part is its own AI call, its
// reply is checked (question count in IELTS marks, answer keys, passage and
// transcript length, a complete cue card...), a rejected or cut-off reply is
// asked for again with the reason, and a part that still fails is recorded
// in `content.generation.failed` with an empty slot - never dropped quietly.

export type PartKey =
  | 'listening.0'
  | 'listening.1'
  | 'listening.2'
  | 'listening.3'
  | 'reading.0'
  | 'reading.1'
  | 'reading.2'
  | 'writing'
  | 'speaking';

export const PART_KEYS: PartKey[] = [
  'listening.0',
  'listening.1',
  'listening.2',
  'listening.3',
  'reading.0',
  'reading.1',
  'reading.2',
  'writing',
  'speaking',
];
export const isPartKey = (k: unknown): k is PartKey =>
  typeof k === 'string' && (PART_KEYS as string[]).includes(k);

// IELTS: 4 x 10 Listening, 13 + 13 + 14 Reading.
export const LISTENING_MARKS = [10, 10, 10, 10];
export const READING_MARKS = [13, 13, 14];
const LISTENING_FROM = [1, 11, 21, 31];
const READING_FROM = [1, 14, 27];
// Lower bounds that still read as a complete part (the prompts ask for more).
export const MIN_TRANSCRIPT_WORDS = 250;
export const MIN_PASSAGE_WORDS = 500;

export function partLabel(key: string): string {
  const [s, i] = key.split('.');
  if (s === 'listening') return `Listening Part ${Number(i) + 1}`;
  if (s === 'reading') return `Reading Passage ${Number(i) + 1}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const words = (t: string | null | undefined) =>
  (t ?? '').split(/\s+/).filter(Boolean).length;

// ------------------------------------------------------------------ parsing

/** The JSON object of a reply; `truncated` when it was cut off (unclosed braces or string). */
export function parseReply(text: string): {
  data: Record<string, unknown> | null;
  truncated: boolean;
} {
  const data = parseLooseJson(text);
  if (data) return { data, truncated: false };
  const start = text.indexOf('{');
  if (start < 0) return { data: null, truncated: false };
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of text.slice(start)) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return { data: null, truncated: inString || depth > 0 };
}

// --------------------------------------------------------------- checking

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

const unkeyed = (qs: ListeningPart['questions']) =>
  qs.filter((q) =>
    q.type === 'MATCHING' ? !(q.pairs ?? []).length : !q.correctAnswer.trim(),
  ).length;

// Keeps whole questions up to `want` marks; the part is complete only at exactly `want`.
function fitMarks(
  qs: ListeningPart['questions'],
  want: number,
): Check<ListeningPart['questions']> {
  const out: ListeningPart['questions'] = [];
  let marks = 0;
  for (const q of qs) {
    if (marks + marksOf(q) > want) break;
    out.push(q);
    marks += marksOf(q);
  }
  if (marks !== want)
    return { ok: false, reason: `${marks} questions instead of ${want}` };
  return { ok: true, value: out };
}

export function checkListeningPart(
  raw: unknown,
  index: number,
): Check<ListeningPart> {
  const part = normalizeContent({ listening: { parts: [raw] } }).listening
    .parts[0];
  if (!part) return { ok: false, reason: 'no part in the reply' };
  if (words(part.transcript) < MIN_TRANSCRIPT_WORDS)
    return {
      ok: false,
      reason: `the audioscript is missing or too short (${words(part.transcript)} words, need ${MIN_TRANSCRIPT_WORDS}+)`,
    };
  const fit = fitMarks(part.questions, LISTENING_MARKS[index]);
  if (!fit.ok) return fit;
  const missing = unkeyed(fit.value);
  if (missing)
    return { ok: false, reason: `${missing} questions have no correctAnswer` };
  return {
    ok: true,
    value: {
      ...part,
      title: `Part ${index + 1}`,
      audioPath: null,
      questions: fit.value,
    },
  };
}

export function checkReadingPassage(
  raw: unknown,
  index: number,
): Check<ReadingPassage> {
  const p = normalizeContent({ reading: { passages: [raw] } }).reading
    .passages[0];
  if (!p) return { ok: false, reason: 'no passage in the reply' };
  if (words(p.text) < MIN_PASSAGE_WORDS)
    return {
      ok: false,
      reason: `the passage text is missing or too short (${words(p.text)} words, need ${MIN_PASSAGE_WORDS}+)`,
    };
  const fit = fitMarks(p.questions, READING_MARKS[index]);
  if (!fit.ok) return fit;
  const missing = unkeyed(fit.value);
  if (missing)
    return { ok: false, reason: `${missing} questions have no correctAnswer` };
  return { ok: true, value: { ...p, questions: fit.value } };
}

export function checkWriting(
  raw: unknown,
  module: string,
): Check<WritingTask[]> {
  const tasks = normalizeContent({
    writing: { tasks: (raw as { tasks?: unknown })?.tasks },
  }).writing.tasks;
  if (tasks.length !== 2)
    return { ok: false, reason: `${tasks.length} tasks instead of 2` };
  const [t1, t2] = tasks;
  if (module !== 'GENERAL') {
    const chart = t1.prompt.split(/\[chart\]/i)[1];
    if (chart === undefined)
      return { ok: false, reason: 'Task 1 has no "[Chart]" description' };
    if (words(chart) < 40)
      return {
        ok: false,
        reason:
          'the Task 1 chart description is too short (need every label and number)',
      };
  } else if (words(t1.prompt) < 30) {
    return { ok: false, reason: 'the Task 1 letter situation is too short' };
  }
  if (words(t2.prompt) < 12)
    return { ok: false, reason: 'the Task 2 question is too short' };
  return {
    ok: true,
    value: [
      { ...t1, title: 'Task 1', minWords: 150 },
      { ...t2, title: 'Task 2', minWords: 250 },
    ],
  };
}

// Points of a Part 2 cue card between "You should say" and "and explain".
export function cueCardPoints(card: string): number {
  const m = card.match(/you should say:?([\s\S]*?)(?:\band explain\b|$)/i);
  if (!m) return 0;
  return m[1]
    .split(/\n|•|(?:^|\s)[-*]\s/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2).length;
}

export function checkSpeaking(raw: unknown): Check<SpeakingPart[]> {
  const rawParts = Array.isArray((raw as { parts?: unknown })?.parts)
    ? (raw as { parts: unknown[] }).parts
    : [];
  // A cue card sent as several lines is one card.
  const fixed = rawParts.map((p, i) => {
    const qs = (p as { questions?: unknown })?.questions;
    return i === 1 && Array.isArray(qs) && qs.length > 1
      ? { ...(p as object), questions: [qs.map(String).join('\n')] }
      : p;
  });
  const parts = normalizeContent({ speaking: { parts: fixed } }).speaking.parts;
  if (parts.length !== 3)
    return { ok: false, reason: `${parts.length} parts instead of 3` };
  if (parts[0].questions.length < 6)
    return {
      ok: false,
      reason: `Part 1 has ${parts[0].questions.length} questions (need 6+)`,
    };
  const card = parts[1].questions[0] ?? '';
  if (
    !/you should say/i.test(card) ||
    !/and explain/i.test(card) ||
    cueCardPoints(card) < 3
  ) {
    return {
      ok: false,
      reason:
        'the Part 2 cue card is incomplete (needs the topic, "You should say:" with 3-4 points, and "and explain")',
    };
  }
  if (parts[2].questions.length < 4)
    return {
      ok: false,
      reason: `Part 3 has ${parts[2].questions.length} questions (need 4+)`,
    };
  return {
    ok: true,
    value: parts.map((p, i) => ({ ...p, title: `Part ${i + 1}` })),
  };
}

// ------------------------------------------------------------- the plan

export interface PartSpec {
  key: PartKey;
  topic: string;
  prompt: string;
  maxTokens: number;
  check: (data: Record<string, unknown>) => Check<unknown>;
}

export type Topics = GenerationPlan;

const L_FALLBACK = [
  'booking a hotel room',
  'a local museum tour',
  'a university project',
  'urban wildlife',
];
const R_FALLBACK = [
  'the history of a common invention',
  'how cities adapt to climate',
  'memory and learning',
];

// Reply sizes: a passage of ~900 words plus 13-14 questions with
// explanations is ~8-10k tokens of JSON; thinking models (Gemini) spend part
// of the same budget before they write, so the budget is generous.
const TOKENS = {
  listening: 20_000,
  reading: 24_000,
  writing: 8000,
  speaking: 6000,
};

export function specFor(
  key: PartKey,
  t: Topics,
  level: string | null,
  module: string,
): PartSpec {
  const [s, n] = key.split('.');
  const i = Number(n);
  if (s === 'listening') {
    const topic = t.listening[i] ?? L_FALLBACK[i];
    return {
      key,
      topic,
      prompt: listeningPartPrompt(
        i + 1,
        topic,
        level,
        LISTENING_FROM[i],
        LISTENING_MARKS[i],
      ),
      maxTokens: TOKENS.listening,
      check: (d) => checkListeningPart(d, i),
    };
  }
  if (s === 'reading') {
    const topic = t.reading[i] ?? R_FALLBACK[i];
    return {
      key,
      topic,
      prompt: readingPassagePrompt(
        i + 1,
        topic,
        level,
        READING_FROM[i],
        READING_MARKS[i],
        module,
      ),
      maxTokens: TOKENS.reading,
      check: (d) => checkReadingPassage(d, i),
    };
  }
  if (s === 'writing') {
    return {
      key,
      topic: `${t.writing.task1} / ${t.writing.task2}`,
      prompt: writingGenPrompt(t.writing.task1, t.writing.task2, level, module),
      maxTokens: TOKENS.writing,
      check: (d) => checkWriting(d, module),
    };
  }
  return {
    key,
    topic: t.speaking.part2,
    prompt: speakingGenPrompt(t.speaking, level),
    maxTokens: TOKENS.speaking,
    check: (d) => checkSpeaking(d),
  };
}

// ------------------------------------------------------------ running

export interface TextAi {
  completeText(prompt: string, maxTokens: number): Promise<string>;
}

export type PartResult =
  | { key: PartKey; ok: true; value: unknown; attempts: number }
  | { key: PartKey; ok: false; error: string; attempts: number };

export const PART_ATTEMPTS = 3;

/** One part: asks, checks, and asks again with the reason (up to `attempts` times). */
export async function runPart(
  ai: TextAi,
  spec: PartSpec,
  attempts = PART_ATTEMPTS,
): Promise<PartResult> {
  let error = 'no reply';
  let feedback = '';
  for (let a = 1; a <= attempts; a++) {
    let text: string;
    try {
      text = await ai.completeText(spec.prompt + feedback, spec.maxTokens);
    } catch (err) {
      error = (err as Error).message || 'AI error';
      feedback = '';
      continue;
    }
    const { data, truncated } = parseReply(text);
    if (!data) {
      error = truncated
        ? 'the reply was cut off before the end'
        : 'the reply was not valid JSON';
    } else {
      const res = spec.check(data);
      if (res.ok)
        return { key: spec.key, ok: true, value: res.value, attempts: a };
      error = res.reason;
    }
    feedback = `\n\nIMPORTANT: your previous reply was rejected: ${error}. Reply again with the COMPLETE JSON object and nothing else.${
      truncated
        ? ' It was cut off, so keep every "explanation" under 12 words and write no text outside the JSON.'
        : ''
    }`;
  }
  return { key: spec.key, ok: false, error, attempts };
}

/** Runs jobs `size` at a time (the AI is rate limited). */
export async function pool<T>(
  jobs: Array<() => Promise<T>>,
  size = 3,
): Promise<T[]> {
  const out: T[] = Array.from({ length: jobs.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

// ------------------------------------------------------- building content

const emptyListening = (i: number): ListeningPart => ({
  title: `Part ${i + 1}`,
  instruction: null,
  audioPath: null,
  transcript: null,
  imagePath: null,
  questions: [],
});
const emptyPassage = (i: number): ReadingPassage => ({
  title: `Passage ${i + 1}`,
  text: '',
  imagePath: null,
  questions: [],
});

/** Puts results into their slots of `content` (a failed part keeps an empty slot). */
export function applyResults(
  content: MockContent,
  results: PartResult[],
): MockContent {
  const c = structuredClone(content);
  while (c.listening.parts.length < 4)
    c.listening.parts.push(emptyListening(c.listening.parts.length));
  while (c.reading.passages.length < 3)
    c.reading.passages.push(emptyPassage(c.reading.passages.length));
  const gen: GenerationMeta = c.generation ?? emptyMeta();
  for (const r of results) {
    gen.failed = gen.failed.filter((f) => f.key !== r.key);
    if (!r.ok) {
      gen.failed.push({
        key: r.key,
        label: partLabel(r.key),
        error: r.error.slice(0, 300),
      });
      continue;
    }
    const [s, n] = r.key.split('.');
    const i = Number(n);
    if (s === 'listening') c.listening.parts[i] = r.value as ListeningPart;
    else if (s === 'reading') c.reading.passages[i] = r.value as ReadingPassage;
    else if (s === 'writing') c.writing.tasks = r.value as WritingTask[];
    else c.speaking.parts = r.value as SpeakingPart[];
  }
  gen.failed.sort(
    (a, b) =>
      PART_KEYS.indexOf(a.key as PartKey) - PART_KEYS.indexOf(b.key as PartKey),
  );
  c.generation = gen;
  return c;
}

export function emptyMeta(): GenerationMeta {
  return {
    failed: [],
    running: [],
    runningSince: null,
    tts: null,
    ttsError: null,
    plan: null,
  };
}

/** Whether the slot of `key` in `content` now holds a complete part (e.g. the teacher filled it in). */
export function slotComplete(
  content: MockContent,
  key: PartKey,
  module: string,
): boolean {
  const [s, n] = key.split('.');
  const i = Number(n);
  if (s === 'listening') {
    const p = content.listening.parts[i];
    // An uploaded recording stands in for the audioscript.
    return (
      !!p &&
      checkListeningPart(
        {
          ...p,
          transcript:
            p.audioPath || content.listening.audioPath
              ? 'x '.repeat(MIN_TRANSCRIPT_WORDS)
              : p.transcript,
        },
        i,
      ).ok
    );
  }
  if (s === 'reading')
    return (
      !!content.reading.passages[i] &&
      checkReadingPassage(content.reading.passages[i], i).ok
    );
  if (s === 'writing') {
    const t = content.writing.tasks;
    // A picture uploaded for Task 1 replaces the written chart description.
    return (
      t.length === 2 &&
      t.every((x) => words(x.prompt) >= 5) &&
      (module === 'GENERAL' ||
        !!t[0].imagePath ||
        /\[chart\]/i.test(t[0].prompt))
    );
  }
  return (
    content.speaking.parts.length === 3 &&
    content.speaking.parts.every((p) => p.questions.length > 0)
  );
}

/** Listening parts (indexes) of an AI test that still have no recording. */
export function partsWithoutAudio(content: MockContent): number[] {
  if (content.listening.audioPath) return [];
  return content.listening.parts
    .map((p, i) => (p.audioPath ? -1 : i))
    .filter((i) => i >= 0);
}

/** Why an AI-written test may not be published yet, or null. */
export function publishBlocker(content: MockContent): string | null {
  const gen = content.generation;
  if (!gen) return null;
  if (gen.running.length) return 'AI hali yozmoqda — tugashini kuting';
  if (gen.failed.length)
    return `${gen.failed.map((f) => f.label).join(', ')} yaratilmadi — avval qayta urining yoki qo'lda to'ldiring`;
  const silent = partsWithoutAudio(content);
  if (silent.length)
    return `Listening audio kerak: ${silent.map((i) => `Part ${i + 1}`).join(', ')} — audio yuklang yoki AI bilan yarating`;
  return null;
}
