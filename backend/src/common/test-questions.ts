// One question model for exams and placement tests: the types a real paper
// test uses (like the IELTS/CEFR style sheets centers upload as PDFs), how
// to clean questions that come from AI or the browser, and how to grade an
// answer. Essays are graded by the teacher (AI can suggest a score).

export const QUESTION_TYPES = [
  'MCQ',              // one correct option (A, B, C, D)
  'TRUE_FALSE',       // True / False
  'TRUE_FALSE_NG',    // True / False / Not Given
  'FILL_BLANK',       // write the missing word(s)
  'SHORT_ANSWER',     // a short written answer
  'MATCHING',         // match left items to right items
  'WORD_ORDER',       // put the words in order
  'ERROR_CORRECTION', // find and fix the mistake
  'TRANSFORMATION',   // rewrite keeping the meaning (key word given)
  'WORD_FORMATION',   // form a word from the one in capitals
  'ESSAY',            // open writing, graded by the teacher
  'MCQ_MULTI',        // choose TWO (or more) options; one mark per right letter
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHOICE_TYPES: QuestionType[] = ['MCQ', 'TRUE_FALSE', 'TRUE_FALSE_NG'];
export const TEXT_TYPES: QuestionType[] = ['FILL_BLANK', 'SHORT_ANSWER', 'ERROR_CORRECTION', 'TRANSFORMATION', 'WORD_FORMATION', 'WORD_ORDER'];

export interface QuestionOption {
  id: string;
  text: string;
}

export interface MatchingPair {
  left: string;
  right: string;
}

// Stored form (with answers).
export interface TestQuestion {
  type: QuestionType;
  prompt: string;
  section?: string | null;
  instruction?: string | null;
  passage?: string | null;
  options?: QuestionOption[];
  // Choice: option id. Text types: accepted answers joined by "|"; parts
  // in round brackets are optional ("(the) Ulugh Beg Madrasa"). Empty for
  // MATCHING (see pairs) and ESSAY.
  correctAnswer: string;
  pairs?: MatchingPair[];
  // MATCHING: extra choices that match nothing (IELTS lists more headings
  // than paragraphs).
  extra?: string[];
  words?: string[];
  rubric?: string | null;
  explanation?: string | null;
  points: number;
  level?: 1 | 2 | 3;
}

const TF_OPTIONS: QuestionOption[] = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }];
const TFNG_OPTIONS: QuestionOption[] = [{ id: 'true', text: 'True' }, { id: 'false', text: 'False' }, { id: 'ng', text: 'Not Given' }];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim());

// "A) went" / "b. went" -> "went": the letter is shown separately.
const stripLetter = (t: string) => t.replace(/^\(?[A-Ha-h][).:]\s+/, '');

function normalizeTF(answer: string, ng: boolean) {
  const a = answer.toLowerCase().replace(/[^a-z]/g, '');
  if (['t', 'true', 'yes', 'rost', 'togri', 'verno', 'da'].includes(a)) return 'true';
  if (['f', 'false', 'no', 'notogri', 'yolgon', 'neverno', 'net'].includes(a)) return 'false';
  if (ng && ['ng', 'notgiven', 'berilmagan', 'neukazano'].includes(a)) return 'ng';
  return '';
}

// Cleans one question from AI output or the browser. Returns null when it
// cannot be used (no prompt, no answer for a gradable type, ...).
// `requireAnswer: false` keeps questions without an answer (PDF review).
export function normalizeQuestion(raw: unknown, opts: { requireAnswer?: boolean } = {}): TestQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  const requireAnswer = opts.requireAnswer ?? true;
  const prompt = str(q.prompt);
  let type = str(q.type || q.questionType).toUpperCase() as QuestionType;
  if (!QUESTION_TYPES.includes(type)) type = 'MCQ';
  const points = Number.isFinite(Number(q.points)) && Number(q.points) > 0 ? Math.min(100, Math.round(Number(q.points))) : 1;
  const level = [1, 2, 3].includes(Number(q.level)) ? (Number(q.level) as 1 | 2 | 3) : undefined;
  const base = {
    type,
    prompt,
    section: str(q.section) || null,
    instruction: str(q.instruction) || null,
    passage: str(q.passage) || null,
    explanation: str(q.explanation) || null,
    points,
    ...(level ? { level } : {}),
  };
  let answer = str(q.correctAnswer ?? q.answer);

  if (type === 'MATCHING') {
    const pairs = (Array.isArray(q.pairs) ? q.pairs : [])
      .map((p) => ({ left: str((p as MatchingPair)?.left), right: str((p as MatchingPair)?.right) }))
      .filter((p) => p.left && (p.right || !requireAnswer));
    if (pairs.length < 2) return null;
    if (requireAnswer && pairs.some((p) => !p.right)) return null;
    const rights = new Set(pairs.map((p) => p.right));
    const extra = [...new Set((Array.isArray(q.extra) ? q.extra : []).map(str).filter((x) => x && !rights.has(x)))].slice(0, 10);
    return { ...base, prompt: prompt || 'Match the items.', pairs, ...(extra.length ? { extra } : {}), correctAnswer: '', points: Math.max(points, 1) };
  }
  if (!prompt) return null;

  if (type === 'ESSAY') {
    return { ...base, correctAnswer: '', rubric: str(q.rubric) || answer || null };
  }

  if (type === 'MCQ_MULTI') {
    const rawOpts = Array.isArray(q.options) ? q.options : [];
    const options = rawOpts
      .map((o, i) => (typeof o === 'string'
        ? { id: String.fromCharCode(65 + i), text: stripLetter(o.trim()) }
        : { id: str((o as QuestionOption)?.id) || String.fromCharCode(65 + i), text: stripLetter(str((o as QuestionOption)?.text)) }))
      .filter((o) => o.text);
    if (options.length < 3) return null;
    // "A, C" / "A and C" / ["A", "C"] -> "A,C"
    const rawKey = Array.isArray(q.correctAnswer ?? q.answer) ? (q.correctAnswer ?? q.answer) as unknown[] : answer.split(/[\s,;&/]+|\band\b/i);
    const ids = new Set(options.map((o) => o.id.toUpperCase()));
    const letters = [...new Set(rawKey.map((x) => str(x).replace(/[()]/g, '').toUpperCase()).filter((x) => ids.has(x)))].sort();
    if (letters.length === 0 && requireAnswer) return null;
    return { ...base, options, correctAnswer: letters.join(','), points: Math.max(letters.length, 1) };
  }

  if (CHOICE_TYPES.includes(type)) {
    let options: QuestionOption[];
    if (type === 'TRUE_FALSE') options = TF_OPTIONS;
    else if (type === 'TRUE_FALSE_NG') options = TFNG_OPTIONS;
    else {
      const rawOpts = Array.isArray(q.options) ? q.options : [];
      options = rawOpts
        .map((o, i) => (typeof o === 'string'
          ? { id: String.fromCharCode(65 + i), text: stripLetter(o.trim()) }
          : { id: str((o as QuestionOption)?.id) || String.fromCharCode(65 + i), text: stripLetter(str((o as QuestionOption)?.text)) }))
        .filter((o) => o.text);
      if (options.length < 2) return null;
    }
    if (type === 'MCQ') {
      // Accept "B", "b", "B) had" or the option text itself.
      const letter = answer.match(/^\(?([A-Za-z])\)?(?:[).:\s]|$)/)?.[1]?.toUpperCase();
      const byId = options.find((o) => o.id.toUpperCase() === (letter ?? answer.toUpperCase()));
      const byText = options.find((o) => o.text.toLowerCase() === answer.toLowerCase());
      answer = byId?.id ?? byText?.id ?? '';
      if (Number.isInteger(q.correctIndex) && !answer) answer = options[Number(q.correctIndex)]?.id ?? '';
    } else {
      answer = normalizeTF(answer, type === 'TRUE_FALSE_NG');
      if (!answer && Number.isInteger(q.correctIndex)) answer = options[Number(q.correctIndex)]?.id ?? '';
    }
    if (!answer && requireAnswer) return null;
    return { ...base, options, correctAnswer: answer };
  }

  // Text types.
  const words = type === 'WORD_ORDER'
    ? (Array.isArray(q.words) ? q.words.map(str).filter(Boolean) : prompt.split('/').map((w) => w.trim()).filter(Boolean))
    : undefined;
  if (!answer && requireAnswer) return null;
  return { ...base, correctAnswer: answer, ...(words ? { words } : {}) };
}

// ---- grading ----

const clean = (s: string) =>
  s.toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[.,!?;:"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "(the) Ulugh Beg Madrasa|Ulugh Beg" -> every accepted spelling, with and
// without the optional parts in brackets.
export function acceptedAnswers(key: string): string[] {
  const out = new Set<string>();
  for (const alt of key.split('|').map((a) => a.trim()).filter(Boolean)) {
    const optional = [...alt.matchAll(/\(([^)]*)\)/g)];
    const combos = 1 << Math.min(optional.length, 4);
    for (let mask = 0; mask < combos; mask++) {
      let i = 0;
      const text = alt.replace(/\(([^)]*)\)/g, (_, inner: string) => ((mask >> i++) & 1 ? inner : ''));
      out.add(clean(text));
    }
  }
  return [...out].filter(Boolean);
}

export interface GradeResult {
  earned: number;
  max: number;
  // ESSAY waits for the teacher.
  pending: boolean;
  correct: boolean;
}

export function gradeAnswer(q: TestQuestion, answer: string | undefined | null): GradeResult {
  const max = q.points || 1;
  const given = (answer ?? '').trim();
  if (q.type === 'ESSAY') return { earned: 0, max, pending: true, correct: false };
  if (q.type === 'MATCHING') {
    let map: Record<string, string> = {};
    try {
      map = given ? JSON.parse(given) : {};
    } catch {
      map = {};
    }
    const pairs = q.pairs ?? [];
    const right = pairs.filter((p, i) => clean(map[String(i)] ?? '') === clean(p.right)).length;
    const earned = pairs.length ? Math.round(((max * right) / pairs.length) * 100) / 100 : 0;
    return { earned, max, pending: false, correct: right === pairs.length && pairs.length > 0 };
  }
  if (q.type === 'MCQ_MULTI') {
    const key = q.correctAnswer.split(',').filter(Boolean);
    const picked = [...new Set(given.toUpperCase().split(/[\s,]+/).filter(Boolean))];
    const right = picked.filter((x) => key.includes(x)).length;
    // Ticking more boxes than asked does not earn the extra marks.
    const hits = Math.max(0, right - Math.max(0, picked.length - key.length));
    const earned = key.length ? Math.round(((max * hits) / key.length) * 100) / 100 : 0;
    return { earned, max, pending: false, correct: key.length > 0 && hits === key.length };
  }
  if (!given) return { earned: 0, max, pending: false, correct: false };
  let ok: boolean;
  if (CHOICE_TYPES.includes(q.type)) {
    ok = given.toLowerCase() === q.correctAnswer.toLowerCase();
  } else {
    const accepted = acceptedAnswers(q.correctAnswer);
    const g = clean(given);
    // Error correction: the fixed word alone is accepted too when the key
    // lists it; the full corrected sentence always is.
    ok = accepted.includes(g);
  }
  return { earned: ok ? max : 0, max, pending: false, correct: ok };
}

// What the student sees: no answers, matching right-hand items shuffled.
export function publicQuestion(q: TestQuestion, seed = 0) {
  const base = {
    type: q.type,
    prompt: q.prompt,
    section: q.section ?? null,
    instruction: q.instruction ?? null,
    passage: q.passage ?? null,
    points: q.points,
  };
  if (q.type === 'MATCHING') {
    const rights = [...new Set([...(q.pairs ?? []).map((p) => p.right), ...(q.extra ?? [])])].filter(Boolean);
    // Deterministic shuffle so the order is stable for one test.
    const shuffled = rights.map((r, i) => ({ r, k: Math.sin(seed + i + 1) })).sort((a, b) => a.k - b.k).map((x) => x.r);
    return { ...base, left: (q.pairs ?? []).map((p) => p.left), right: shuffled };
  }
  if (q.type === 'WORD_ORDER') return { ...base, words: q.words ?? [] };
  if (CHOICE_TYPES.includes(q.type)) return { ...base, options: q.options ?? [] };
  if (q.type === 'MCQ_MULTI') return { ...base, options: q.options ?? [], pick: Math.max(1, q.correctAnswer.split(',').filter(Boolean).length) };
  return base;
}

// Suggested level (1-3) from graded questions that carry a level: advanced
// needs most level-3 points on top of level 2, and so on. Essays and
// questions without a level are ignored.
export function suggestLevel(questions: TestQuestion[], grades: GradeResult[]): 1 | 2 | 3 {
  const ratio = (level: number) => {
    let earned = 0;
    let max = 0;
    questions.forEach((q, i) => {
      if (q.level !== level || grades[i]?.pending) return;
      earned += grades[i]?.earned ?? 0;
      max += grades[i]?.max ?? 0;
    });
    return max > 0 ? (earned / max) * 100 : null;
  };
  const ok = (p: number | null, min: number) => p === null || p >= min;
  const [l1, l2, l3] = [ratio(1), ratio(2), ratio(3)];
  if (l3 !== null && l3 >= 60 && ok(l2, 70)) return 3;
  if (l2 !== null && l2 >= 60 && ok(l1, 70)) return 2;
  return 1;
}
