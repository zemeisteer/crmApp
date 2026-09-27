import type { TranslationKey } from "./i18n";

// Mirrors backend/src/common/test-questions.ts.
export const QUESTION_TYPES = [
  "MCQ",
  "TRUE_FALSE",
  "TRUE_FALSE_NG",
  "FILL_BLANK",
  "SHORT_ANSWER",
  "MATCHING",
  "WORD_ORDER",
  "ERROR_CORRECTION",
  "TRANSFORMATION",
  "WORD_FORMATION",
  "ESSAY",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionOption {
  id: string;
  text: string;
}

// Full question (teacher side, with answers).
export interface TestQuestion {
  id?: string;
  type: QuestionType;
  prompt: string;
  section?: string | null;
  instruction?: string | null;
  passage?: string | null;
  options?: QuestionOption[];
  correctAnswer: string;
  pairs?: Array<{ left: string; right: string }> | null;
  words?: string[] | null;
  rubric?: string | null;
  explanation?: string | null;
  points: number;
  level?: 1 | 2 | 3;
}

// What a student receives (no answers).
export interface PublicQuestion {
  id?: string;
  type: QuestionType;
  prompt: string;
  section?: string | null;
  instruction?: string | null;
  passage?: string | null;
  points?: number;
  options?: QuestionOption[];
  left?: string[];
  right?: string[];
  words?: string[];
}

export const TYPE_INFO: Record<QuestionType, { icon: string; label: TranslationKey; hint: TranslationKey }> = {
  MCQ: { icon: "🔘", label: "qt.MCQ", hint: "qt.MCQ.hint" },
  TRUE_FALSE: { icon: "✅", label: "qt.TRUE_FALSE", hint: "qt.TRUE_FALSE.hint" },
  TRUE_FALSE_NG: { icon: "❔", label: "qt.TRUE_FALSE_NG", hint: "qt.TRUE_FALSE_NG.hint" },
  FILL_BLANK: { icon: "✏️", label: "qt.FILL_BLANK", hint: "qt.FILL_BLANK.hint" },
  SHORT_ANSWER: { icon: "💬", label: "qt.SHORT_ANSWER", hint: "qt.SHORT_ANSWER.hint" },
  MATCHING: { icon: "🔗", label: "qt.MATCHING", hint: "qt.MATCHING.hint" },
  WORD_ORDER: { icon: "🔀", label: "qt.WORD_ORDER", hint: "qt.WORD_ORDER.hint" },
  ERROR_CORRECTION: { icon: "🩹", label: "qt.ERROR_CORRECTION", hint: "qt.ERROR_CORRECTION.hint" },
  TRANSFORMATION: { icon: "🔁", label: "qt.TRANSFORMATION", hint: "qt.TRANSFORMATION.hint" },
  WORD_FORMATION: { icon: "🧩", label: "qt.WORD_FORMATION", hint: "qt.WORD_FORMATION.hint" },
  ESSAY: { icon: "📝", label: "qt.ESSAY", hint: "qt.ESSAY.hint" },
};

export const isChoice = (t: QuestionType) => t === "MCQ" || t === "TRUE_FALSE" || t === "TRUE_FALSE_NG";

export const hasAnswer = (q: TestQuestion) =>
  q.type === "ESSAY" ? true : q.type === "MATCHING" ? (q.pairs ?? []).length >= 2 && (q.pairs ?? []).every((p) => p.left.trim() && p.right.trim()) : Boolean(q.correctAnswer?.trim());

// Default options for choice types.
export const TF_OPTIONS: QuestionOption[] = [{ id: "true", text: "True" }, { id: "false", text: "False" }];
export const TFNG_OPTIONS: QuestionOption[] = [...TF_OPTIONS, { id: "ng", text: "Not Given" }];

// Group consecutive questions for display: a header (section, instruction,
// passage) is shown only when it changes.
export function headerChanges<T extends { section?: string | null; instruction?: string | null; passage?: string | null }>(list: T[], i: number) {
  const q = list[i];
  const prev = list[i - 1];
  return {
    section: q.section && q.section !== prev?.section ? q.section : null,
    instruction: q.instruction && (q.instruction !== prev?.instruction || q.section !== prev?.section) ? q.instruction : null,
    passage: q.passage && q.passage !== prev?.passage ? q.passage : null,
  };
}

// Whether a student gave an answer (matching: every item linked).
export function isAnswered(q: PublicQuestion, value: string | undefined) {
  const v = (value ?? "").trim();
  if (!v) return false;
  if (q.type !== "MATCHING") return true;
  try {
    const map = JSON.parse(v) as Record<string, string>;
    return (q.left ?? []).every((_, i) => Boolean(map[String(i)]));
  } catch {
    return false;
  }
}
