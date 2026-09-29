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
  // Map, plan or diagram the questions refer to.
  imagePath: string | null;
  questions: TestQuestion[];
}

export interface ReadingPassage {
  title: string;
  text: string;
  imagePath: string | null;
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
  // audioPath: one recording for the whole section (the real exam plays the
  // four parts without a break); a part's own audio is used otherwise.
  listening: { durationMin: number; audioPath: string | null; parts: ListeningPart[] };
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
// Questions without a key are kept (an import may miss some); publishing
// is refused until every question has one (see missingKeys).
const questionsOf = (v: unknown) =>
  arr(v).map((q) => normalizeQuestion(q, { requireAnswer: false })).filter((q): q is TestQuestion => q !== null && q.type !== 'ESSAY').slice(0, 60);

// Listening/Reading questions that still have no answer key.
export function missingKeys(content: MockContent): number {
  return [...sectionQuestions(content, 'listening'), ...sectionQuestions(content, 'reading')]
    .filter((q) => (q.type === 'MATCHING' ? !(q.pairs ?? []).length : !q.correctAnswer.trim())).length;
}

// Cleans content that comes from the editor (or AI): unknown fields are
// dropped, limits applied, questions validated with the shared model.
export function normalizeContent(raw: unknown): MockContent {
  const r = (raw ?? {}) as Record<string, any>;
  return {
    listening: {
      durationMin: num(r.listening?.durationMin, DEFAULT_DURATIONS.listening, 5, 90),
      audioPath: str(r.listening?.audioPath, 300) || null,
      parts: arr(r.listening?.parts).slice(0, 6).map((p: any) => ({
        title: str(p?.title, 200) || 'Part',
        instruction: str(p?.instruction, 2000) || null,
        audioPath: str(p?.audioPath, 300) || null,
        transcript: str(p?.transcript, 20_000) || null,
        imagePath: str(p?.imagePath, 300) || null,
        questions: questionsOf(p?.questions),
      })),
    },
    reading: {
      durationMin: num(r.reading?.durationMin, DEFAULT_DURATIONS.reading, 5, 120),
      passages: arr(r.reading?.passages).slice(0, 5).map((p: any) => ({
        title: str(p?.title, 300) || 'Passage',
        text: str(p?.text, 30_000),
        imagePath: str(p?.imagePath, 300) || null,
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

// Marks a question is worth in IELTS: "choose TWO" counts two.
export function marksOf(q: TestQuestion): number {
  return q.type === 'MCQ_MULTI' ? Math.max(1, q.correctAnswer.split(',').filter(Boolean).length) : 1;
}

// What the student receives: no keys; a listening transcript only when the
// part has no recording (it is read aloud instead). Questions are numbered
// like the paper: 1-40, a "choose TWO" question taking two numbers.
export function publicContent(content: MockContent) {
  let n = 0;
  let idx = 0;
  const pub = (q: TestQuestion) => {
    const span = marksOf(q);
    const out = { id: String(idx++), no: n + 1, span, ...publicQuestion(q, n + 1) };
    n += span;
    return out;
  };
  const sectionAudio = content.listening.audioPath;
  const listening = {
    durationMin: content.listening.durationMin,
    audioPath: sectionAudio,
    parts: content.listening.parts.map((p) => ({
      title: p.title, instruction: p.instruction, audioPath: p.audioPath, imagePath: p.imagePath,
      tts: p.audioPath || sectionAudio ? null : p.transcript,
      questions: p.questions.map(pub),
    })),
  };
  n = 0;
  idx = 0;
  const reading = {
    durationMin: content.reading.durationMin,
    passages: content.reading.passages.map((p) => ({ title: p.title, text: p.text, imagePath: p.imagePath, questions: p.questions.map(pub) })),
  };
  return { listening, reading, writing: content.writing, speaking: content.speaking };
}

// Official Listening / Academic Reading conversion (raw score out of 40).
const LISTENING_BANDS: Array<[number, number]> = [
  [39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [3, 2], [1, 1],
];
// General Training Reading needs more right answers for the same band.
const GT_READING_BANDS: Array<[number, number]> = [
  [40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [4, 2], [1, 1],
];
const READING_BANDS: Array<[number, number]> = [
  [39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [3, 2], [1, 1],
];

// A shorter mock is scaled to 40 questions first.
export type MockModule = 'ACADEMIC' | 'GENERAL';

export function rawToBand(section: 'listening' | 'reading', raw: number, max: number, module: MockModule = 'ACADEMIC'): number {
  if (max <= 0) return 0;
  const out40 = Math.round((Math.max(0, Math.min(raw, max)) / max) * 40);
  const table = section === 'listening' ? LISTENING_BANDS : module === 'GENERAL' ? GT_READING_BANDS : READING_BANDS;
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

export function scoreObjective(content: MockContent, section: 'listening' | 'reading', answers: Record<string, string>, module: MockModule = 'ACADEMIC'): ObjectiveResult {
  const questions = sectionQuestions(content, section);
  // One mark per question, per right letter of a "choose TWO".
  const grades = questions.map((q, i) => gradeAnswer({ ...q, points: marksOf(q) }, answers[String(i)]));
  const raw = grades.reduce((s, g) => s + Math.round(g.earned), 0);
  const max = questions.reduce((s, q) => s + marksOf(q), 0);
  return { raw, max, band: rawToBand(section, raw, max, module), marks: grades.map((g) => g.correct) };
}

// ------------------------------------------------------------------ levels

// Levels a test is aimed at (target band). A test without a level (a full
// official exam paper) is open to everyone.
export const LEVELS = ['B4', 'B5', 'B6', 'B7', 'B8'] as const;
export type Level = (typeof LEVELS)[number];

export function isLevel(v: unknown): v is Level {
  return typeof v === 'string' && (LEVELS as readonly string[]).includes(v);
}

export function bandToLevel(band: number): Level {
  return band < 5 ? 'B4' : band < 6 ? 'B5' : band < 7 ? 'B6' : band < 8 ? 'B7' : 'B8';
}

// A group's level written by the center: "6.5", "IELTS 7.0", "B2",
// "Intermediate", "Upper-Intermediate"... -> level, or null.
export function parseLevel(text: string | null | undefined): Level | null {
  const t = (text ?? '').toLowerCase();
  if (!t.trim()) return null;
  const band = t.match(/\b([3-9](?:[.,]5|[.,]0)?)\b/);
  if (band) {
    const n = Number(band[1].replace(',', '.'));
    if (n >= 3 && n <= 9) return bandToLevel(n);
  }
  const cefr = t.match(/\b([abc][12])\b/);
  if (cefr) return ({ a1: 'B4', a2: 'B4', b1: 'B5', b2: 'B6', c1: 'B7', c2: 'B8' } as Record<string, Level>)[cefr[1]];
  if (/upper|yuqori o'rta/.test(t)) return 'B6';
  if (/pre[- ]?inter/.test(t)) return 'B5';
  if (/inter|o'rta/.test(t)) return 'B5';
  if (/advanc|proficien|yuqori/.test(t)) return 'B7';
  if (/beginn|elementary|boshlang/.test(t)) return 'B4';
  return null;
}

// A student may take tests up to one level above their own (and every
// lower one). Unknown student level or a test without level: open.
export function levelOpen(testLevel: Level | null, studentLevel: Level | null): boolean {
  if (!testLevel || !studentLevel) return true;
  return LEVELS.indexOf(testLevel) <= LEVELS.indexOf(studentLevel) + 1;
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
