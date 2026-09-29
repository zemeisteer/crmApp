import { gradeAnswer, normalizeQuestion, publicQuestion, type TestQuestion } from '../common/test-questions';
import { wordCount } from './ielts';

// Practice tests for any direction (general English, math, SAT,
// programming...): timed sections, each with parts (an optional text or
// picture and questions) and open writing tasks. Questions are scored at
// once; tasks go to the AI (or the teacher). Results are percentages.
// IELTS keeps its own four-section format (see ielts.ts).

export const PRACTICE_KIND = 'PRACTICE';
export const MAX_SECTIONS = 6;
// Points one writing task is worth in the section total.
export const TASK_POINTS = 10;

export interface PracticePart {
  title: string;
  text: string | null;
  imagePath: string | null;
  questions: TestQuestion[];
}

export interface PracticeTask {
  title: string;
  prompt: string;
  minWords: number;
  rubric: string | null;
  imagePath: string | null;
}

export interface PracticeSection {
  title: string;
  durationMin: number;
  instruction: string | null;
  parts: PracticePart[];
  tasks: PracticeTask[];
}

export interface PracticeContent {
  sections: PracticeSection[];
}

// Section keys the API and the answers use: "s0", "s1", ...
export const sectionKeyOf = (i: number) => `s${i}`;
export function sectionIndex(key: string, content: PracticeContent): number | null {
  const m = /^s(\d)$/.exec(key);
  if (!m) return null;
  const i = Number(m[1]);
  return i < content.sections.length ? i : null;
}

const str = (v: unknown, max = 20_000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function normalizePractice(raw: unknown): PracticeContent {
  const r = (raw ?? {}) as Record<string, any>;
  return {
    sections: arr(r.sections).slice(0, MAX_SECTIONS).map((s: any, si: number) => ({
      title: str(s?.title, 200) || `Section ${si + 1}`,
      durationMin: num(s?.durationMin, 20, 1, 180),
      instruction: str(s?.instruction, 2000) || null,
      parts: arr(s?.parts).slice(0, 10).map((p: any, pi: number) => ({
        title: str(p?.title, 200) || `Part ${pi + 1}`,
        text: str(p?.text, 30_000) || null,
        imagePath: str(p?.imagePath, 300) || null,
        questions: arr(p?.questions)
          .map((q) => normalizeQuestion(q, { requireAnswer: false }))
          .filter((q): q is TestQuestion => q !== null && q.type !== 'ESSAY')
          .slice(0, 80),
      })),
      tasks: arr(s?.tasks).slice(0, 4).map((t: any, ti: number) => ({
        title: str(t?.title, 200) || `Task ${ti + 1}`,
        prompt: str(t?.prompt, 5000),
        minWords: num(t?.minWords, 0, 0, 2000),
        rubric: str(t?.rubric, 2000) || null,
        imagePath: str(t?.imagePath, 300) || null,
      })).filter((t) => t.prompt),
    })),
  };
}

export const sectionQuestionsOf = (s: PracticeSection) => s.parts.flatMap((p) => p.questions);

export function practiceIsEmpty(c: PracticeContent) {
  return c.sections.every((s) => sectionQuestionsOf(s).length === 0 && s.tasks.length === 0);
}

// Questions still without an answer key (publishing is refused until set).
export function practiceMissingKeys(c: PracticeContent) {
  return c.sections.flatMap(sectionQuestionsOf).filter((q) => (q.type === 'MATCHING' ? !(q.pairs ?? []).length : !q.correctAnswer.trim())).length;
}

// Marks a question takes: matching one per item, "choose TWO" two, else
// its points.
export function practiceMarks(q: TestQuestion) {
  if (q.type === 'MATCHING') return Math.max(1, (q.pairs ?? []).length);
  if (q.type === 'MCQ_MULTI') return Math.max(1, q.correctAnswer.split(',').filter(Boolean).length);
  return Math.max(1, q.points || 1);
}

// What the student receives: no keys. Questions are numbered through the
// section; answers are keyed by their index in the section ("0", "1"...),
// writing tasks by "t0", "t1".
export function publicPractice(c: PracticeContent) {
  return {
    sections: c.sections.map((s, si) => {
      let n = 0;
      let idx = 0;
      return {
        key: sectionKeyOf(si),
        title: s.title,
        durationMin: s.durationMin,
        instruction: s.instruction,
        parts: s.parts.map((p) => ({
          title: p.title,
          text: p.text,
          imagePath: p.imagePath,
          questions: p.questions.map((q) => {
            const span = q.type === 'MATCHING' || q.type === 'MCQ_MULTI' ? practiceMarks(q) : 1;
            const out = { id: String(idx++), no: n + 1, span, ...publicQuestion(q, n + 1) };
            n += span;
            return out;
          }),
        })),
        tasks: s.tasks.map((t) => ({ title: t.title, prompt: t.prompt, minWords: t.minWords, imagePath: t.imagePath })),
      };
    }),
  };
}

export interface PracticeTaskResult {
  score: number | null; // out of TASK_POINTS
  words: number;
  comment: string | null;
}

export interface PracticeSectionResult {
  status: 'DONE' | 'PENDING' | 'REVIEW';
  // Earned / possible points of the section (questions + graded tasks).
  raw: number;
  max: number;
  percent: number | null;
  marks: boolean[];
  tasks?: PracticeTaskResult[];
  teacherComment?: string | null;
  gradedBy?: 'AUTO' | 'AI' | 'TEACHER';
  late?: boolean;
}

// Scores the questions of a section; tasks are counted once they have a
// score (null until the AI or the teacher marks them).
export function scorePracticeSection(section: PracticeSection, answers: Record<string, string>, tasks?: PracticeTaskResult[]): PracticeSectionResult {
  const questions = sectionQuestionsOf(section);
  const grades = questions.map((q, i) => gradeAnswer({ ...q, points: practiceMarks(q) }, answers[String(i)]));
  const qRaw = grades.reduce((s, g) => s + g.earned, 0);
  const qMax = questions.reduce((s, q) => s + practiceMarks(q), 0);
  const taskResults = tasks ?? section.tasks.map((_, i) => ({ score: null, words: wordCount(answers[`t${i}`] ?? ''), comment: null }));
  const waiting = taskResults.some((t) => t.score == null);
  const raw = Math.round((qRaw + taskResults.reduce((s, t) => s + (t.score ?? 0), 0)) * 100) / 100;
  const max = qMax + taskResults.length * TASK_POINTS;
  return {
    status: waiting ? 'REVIEW' : 'DONE',
    raw,
    max,
    percent: waiting || max === 0 ? null : Math.round((raw / max) * 100),
    marks: grades.map((g) => g.correct),
    ...(taskResults.length ? { tasks: taskResults } : {}),
  };
}

// Overall percent once every section has one (weighted by points).
export function practiceOverall(results: Array<PracticeSectionResult | undefined>): number | null {
  if (results.length === 0 || results.some((r) => !r || r.percent == null)) return null;
  const raw = results.reduce((s, r) => s + r!.raw, 0);
  const max = results.reduce((s, r) => s + r!.max, 0);
  return max > 0 ? Math.round((raw / max) * 100) : null;
}

// Keys shown after a section is handed in (to learn from).
export function practiceKeys(section: PracticeSection): string[] {
  return sectionQuestionsOf(section).map((q) =>
    q.type === 'MATCHING'
      ? (q.pairs ?? []).map((p) => `${p.left} → ${p.right}`).join('; ')
      : q.options?.find((o) => o.id === q.correctAnswer)?.text ?? q.correctAnswer.split('|')[0],
  );
}

// Starting points for a new practice test by direction.
export const PRACTICE_TEMPLATES: Record<string, { title: string; sections: Array<{ title: string; durationMin: number; instruction?: string; parts?: string[]; task?: string }> }> = {
  SAT: {
    title: 'SAT practice test',
    sections: [
      { title: 'Reading and Writing — Module 1', durationMin: 32, parts: ['Questions'] },
      { title: 'Reading and Writing — Module 2', durationMin: 32, parts: ['Questions'] },
      { title: 'Math — Module 1', durationMin: 35, instruction: 'Calculator allowed. Enter numbers for student-produced responses.', parts: ['Questions'] },
      { title: 'Math — Module 2', durationMin: 35, instruction: 'Calculator allowed. Enter numbers for student-produced responses.', parts: ['Questions'] },
    ],
  },
  ENGLISH: {
    title: 'General English test',
    sections: [
      { title: 'Grammar and Vocabulary', durationMin: 20, parts: ['Grammar', 'Vocabulary'] },
      { title: 'Reading', durationMin: 25, parts: ['Text 1'] },
      { title: 'Writing', durationMin: 25, task: 'Write an email to a friend about your last holiday (100-150 words).' },
    ],
  },
  MATH: {
    title: 'Math practice',
    sections: [
      { title: 'Part A — without calculator', durationMin: 25, parts: ['Questions'] },
      { title: 'Part B — problems', durationMin: 35, parts: ['Questions'] },
    ],
  },
  PROGRAMMING: {
    title: 'Programming practice',
    sections: [
      { title: 'Theory', durationMin: 15, parts: ['Questions'] },
      { title: 'Read the code', durationMin: 20, instruction: 'What does each program print?', parts: ['Code'] },
      { title: 'Write code', durationMin: 25, task: 'Write a function that returns the largest number in a list. Explain your solution briefly.' },
    ],
  },
  GENERAL: {
    title: 'Practice test',
    sections: [{ title: 'Section 1', durationMin: 30, parts: ['Part 1'] }],
  },
};

export function practiceTemplate(name: string | undefined): { title: string; content: PracticeContent } {
  const t = PRACTICE_TEMPLATES[name ?? ''] ?? PRACTICE_TEMPLATES.GENERAL;
  return {
    title: t.title,
    content: normalizePractice({
      sections: t.sections.map((s) => ({
        title: s.title,
        durationMin: s.durationMin,
        instruction: s.instruction ?? null,
        parts: (s.parts ?? []).map((title) => ({ title, questions: [] })),
        tasks: s.task ? [{ title: 'Task', prompt: s.task, minWords: 80 }] : [],
      })),
    }),
  };
}

// Which template fits a direction (group subject), for the staff editor
// and AI-made practice.
export function templateFor(subject: string): keyof typeof PRACTICE_TEMPLATES {
  const s = subject.toLowerCase();
  if (/\bsat\b/.test(s)) return 'SAT';
  if (/matem|math|algebra|geometr|матем/.test(s)) return 'MATH';
  if (/program|dastur|python|java|web|frontend|backend|it\b|kompyuter|информат|программ/.test(s)) return 'PROGRAMMING';
  if (/ingliz|english|англ/.test(s)) return 'ENGLISH';
  return 'GENERAL';
}
