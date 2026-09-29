import { gradeAnswer, normalizeQuestion, publicQuestion, type TestQuestion } from '../common/test-questions';

// IELTS mock tests: the four sections, what a test holds, how Listening and
// Reading are scored (raw -> band, the official conversion tables), and how
// section bands add up to the overall band. Writing and Speaking bands come
// from the AI examiner or the teacher.

export const SECTIONS = ['listening', 'reading', 'writing', 'speaking'] as const;
export type Section = (typeof SECTIONS)[number];

export interface ListeningPart {
  title: string;
  instruction: string | null;
  // Uploaded recording; without one the page reads `transcript` aloud
  // (browser speech) so a test works before real audio is added.
  audioPath: string | null;
  transcript: string | null;
  questions: TestQuestion[];
}

export interface ReadingPassage {
  title: string;
  text: string;
  questions: TestQuestion[];
}

export interface WritingTask {
  title: string;
  prompt: string;
  minWords: number;
  imagePath: string | null;
}

export interface SpeakingPart {
  title: string;
  instruction: string | null;
  // Seconds to think before answering (Part 2 cue card: 60).
  prepSeconds: number;
  // Seconds per answer.
  answerSeconds: number;
  questions: string[];
}

export interface MockContent {
  listening: { durationMin: number; parts: ListeningPart[] };
  reading: { durationMin: number; passages: ReadingPassage[] };
  writing: { durationMin: number; tasks: WritingTask[] };
  speaking: { parts: SpeakingPart[] };
}

export const DEFAULT_DURATIONS = { listening: 30, reading: 60, writing: 60 } as const;

const str = (v: unknown, max = 20_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const questionsOf = (v: unknown) =>
  arr(v).map((q) => normalizeQuestion(q, { requireAnswer: true })).filter((q): q is TestQuestion => q !== null && q.type !== 'ESSAY').slice(0, 60);

// Cleans content that comes from the editor (or AI): unknown fields are
// dropped, limits applied, questions validated with the shared model.
export function normalizeContent(raw: unknown): MockContent {
  const r = (raw ?? {}) as Record<string, any>;
  return {
    listening: {
      durationMin: num(r.listening?.durationMin, DEFAULT_DURATIONS.listening, 5, 90),
      parts: arr(r.listening?.parts).slice(0, 6).map((p: any) => ({
        title: str(p?.title, 200) || 'Part',
        instruction: str(p?.instruction, 2000) || null,
        audioPath: str(p?.audioPath, 300) || null,
        transcript: str(p?.transcript, 20_000) || null,
        questions: questionsOf(p?.questions),
      })),
    },
    reading: {
      durationMin: num(r.reading?.durationMin, DEFAULT_DURATIONS.reading, 5, 120),
      passages: arr(r.reading?.passages).slice(0, 5).map((p: any) => ({
        title: str(p?.title, 300) || 'Passage',
        text: str(p?.text, 30_000),
        questions: questionsOf(p?.questions),
      })),
    },
    writing: {
      durationMin: num(r.writing?.durationMin, DEFAULT_DURATIONS.writing, 5, 120),
      tasks: arr(r.writing?.tasks).slice(0, 2).map((t: any, i: number) => ({
        title: str(t?.title, 200) || `Task ${i + 1}`,
        prompt: str(t?.prompt, 5000),
        minWords: num(t?.minWords, i === 0 ? 150 : 250, 20, 1000),
        imagePath: str(t?.imagePath, 300) || null,
      })),
    },
    speaking: {
      parts: arr(r.speaking?.parts).slice(0, 3).map((p: any, i: number) => ({
        title: str(p?.title, 200) || `Part ${i + 1}`,
        instruction: str(p?.instruction, 2000) || null,
        prepSeconds: num(p?.prepSeconds, i === 1 ? 60 : 0, 0, 300),
        answerSeconds: num(p?.answerSeconds, i === 1 ? 120 : 45, 10, 300),
        questions: arr(p?.questions).map((q) => str(q, 1000)).filter(Boolean).slice(0, 15),
      })),
    },
  };
}

// Questions of a section in paper order; answers are keyed by that index
// ("0", "1", ...), the number the student sees minus one.
export function sectionQuestions(content: MockContent, section: 'listening' | 'reading'): TestQuestion[] {
  return section === 'listening'
    ? content.listening.parts.flatMap((p) => p.questions)
    : content.reading.passages.flatMap((p) => p.questions);
}

// What the student receives: no keys; a listening transcript only when the
// part has no recording (it is read aloud instead).
export function publicContent(content: MockContent) {
  let n = 0;
  const pub = (q: TestQuestion) => ({ id: String(n), no: ++n, ...publicQuestion(q, n) });
  const listening = {
    durationMin: content.listening.durationMin,
    parts: content.listening.parts.map((p) => ({
      title: p.title, instruction: p.instruction, audioPath: p.audioPath,
      tts: p.audioPath ? null : p.transcript,
      questions: p.questions.map(pub),
    })),
  };
  n = 0;
  const reading = {
    durationMin: content.reading.durationMin,
    passages: content.reading.passages.map((p) => ({ title: p.title, text: p.text, questions: p.questions.map(pub) })),
  };
  return { listening, reading, writing: content.writing, speaking: content.speaking };
}

// Official Listening / Academic Reading conversion (raw score out of 40).
const LISTENING_BANDS: Array<[number, number]> = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [3, 2], [1, 1],
];
const READING_BANDS: Array<[number, number]> = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [3, 2], [1, 1],
];

// A shorter mock is scaled to 40 questions first.
export function rawToBand(section: 'listening' | 'reading', raw: number, max: number): number {
  if (max <= 0) return 0;
  const out40 = Math.round((Math.max(0, Math.min(raw, max)) / max) * 40);
  const table = section === 'listening' ? LISTENING_BANDS : READING_BANDS;
  return table.find(([min]) => out40 >= min)?.[1] ?? 0;
}

// Nearest half band; a .25 average goes up to .5 and .75 to the next whole
// band, as IELTS rounds the overall score.
export function roundBand(x: number): number {
  return Math.round(Math.max(0, Math.min(9, x)) * 2) / 2;
}

export interface ObjectiveResult {
  raw: number;
  max: number;
  band: number;
  // Per question: right or wrong (review after the test).
  marks: boolean[];
}

export function scoreObjective(content: MockContent, section: 'listening' | 'reading', answers: Record<string, string>): ObjectiveResult {
  const questions = sectionQuestions(content, section);
  const grades = questions.map((q, i) => gradeAnswer({ ...q, points: 1 }, answers[String(i)]));
  const raw = grades.reduce((s, g) => s + (g.correct ? 1 : 0), 0);
  return { raw, max: questions.length, band: rawToBand(section, raw, questions.length), marks: grades.map((g) => g.correct) };
}

// Task 2 counts twice as much as Task 1.
export function writingBand(task1: number | null, task2: number | null): number | null {
  if (task1 == null && task2 == null) return null;
  if (task1 == null) return roundBand(task2!);
  if (task2 == null) return roundBand(task1);
  return roundBand((task1 + 2 * task2) / 3);
}

// Overall band once all four sections have one.
export function overallBand(bands: Partial<Record<Section, number | null>>): number | null {
  const all = SECTIONS.map((s) => bands[s]);
  if (all.some((b) => b == null)) return null;
  return roundBand((all as number[]).reduce((a, b) => a + b, 0) / 4);
}

export function wordCount(text: string): number {
  return (text.trim().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length;
}
