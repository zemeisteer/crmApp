// Built-in placement questions, used when no AI key is configured (and as
// a fallback if the AI answer can't be parsed). Level 1 = beginner,
// 2 = intermediate, 3 = advanced. Types are mixed: multiple choice,
// true/false and short "fill the gap" answers.

export type PlacementQuestionType = 'MCQ' | 'TRUE_FALSE' | 'SHORT_ANSWER';

export interface PlacementQuestion {
  type: PlacementQuestionType;
  prompt: string;
  // MCQ: 4 options; TRUE_FALSE: [true label, false label]; SHORT_ANSWER: [].
  options: string[];
  // MCQ / TRUE_FALSE: index of the right option.
  correctIndex?: number;
  // SHORT_ANSWER: accepted answers separated by "|" (case-insensitive).
  answer?: string;
  level: 1 | 2 | 3;
}

const mcq = (level: 1 | 2 | 3, prompt: string, options: string[], correctIndex: number): PlacementQuestion => ({ type: 'MCQ', level, prompt, options, correctIndex });
const tf = (level: 1 | 2 | 3, prompt: string, isTrue: boolean): PlacementQuestion => ({ type: 'TRUE_FALSE', level, prompt, options: ['True', 'False'], correctIndex: isTrue ? 0 : 1 });
const short = (level: 1 | 2 | 3, prompt: string, answer: string): PlacementQuestion => ({ type: 'SHORT_ANSWER', level, prompt, options: [], answer });

export const ENGLISH_BANK: PlacementQuestion[] = [
  mcq(1, 'She ___ a teacher.', ['am', 'is', 'are', 'be'], 1),
  mcq(1, 'I ___ coffee every morning.', ['drinks', 'drinking', 'drink', 'am drink'], 2),
  mcq(1, 'There ___ two books on the table.', ['is', 'are', 'be', 'has'], 1),
  tf(1, '"Children" is the plural of "child".', true),
  short(1, 'Write the opposite of "hot": ______', 'cold'),
  mcq(1, 'We went to the park ___ Sunday.', ['in', 'at', 'on', 'by'], 2),
  short(1, 'Complete: I ___ (be) twelve years old.', 'am|am twelve years old'),
  mcq(2, 'I have lived here ___ 2019.', ['for', 'since', 'from', 'during'], 1),
  mcq(2, 'If it rains tomorrow, we ___ at home.', ['stay', 'will stay', 'would stay', 'stayed'], 1),
  tf(2, '"She has gone to school yesterday" is grammatically correct.', false),
  short(2, 'Write the past tense of "buy": ______', 'bought'),
  mcq(2, 'This is the ___ film I have ever seen.', ['good', 'better', 'best', 'most good'], 2),
  short(2, 'Passive voice: "They built this house in 1990." → This house ___ built in 1990.', 'was'),
  mcq(2, 'Choose the synonym of "reluctant".', ['eager', 'unwilling', 'careful', 'lucky'], 1),
  mcq(3, 'Had I known about the traffic, I ___ earlier.', ['would leave', 'left', 'would have left', 'had left'], 2),
  tf(3, '"Not only was he late, but he also forgot the tickets." uses correct inversion.', true),
  mcq(3, 'The proposal was rejected, ___ surprised no one.', ['that', 'what', 'which', 'it'], 2),
  short(3, 'Complete the idiom: "to beat around the ___" (to avoid the main topic)', 'bush'),
  mcq(3, 'She insisted that he ___ present at the meeting.', ['is', 'was', 'be', 'will be'], 2),
  tf(3, '"Consistent" and "consistently" are both adjectives.', false),
];

export const MATH_BANK: PlacementQuestion[] = [
  mcq(1, '7 × 8 = ?', ['54', '56', '58', '64'], 1),
  short(1, '125 + 378 = ?', '503'),
  mcq(1, '1/2 + 1/4 = ?', ['2/6', '3/4', '1/6', '2/4'], 1),
  tf(1, '20% of 150 is 30.', true),
  mcq(1, 'Perimeter of a square with side 6?', ['12', '24', '36', '18'], 1),
  short(1, '81 : 9 = ?', '9'),
  tf(1, '0.5 × 0.4 = 2', false),
  short(2, 'Solve: 3x − 7 = 11. x = ?', '6|x=6|x = 6'),
  mcq(2, '(a + b)² = ?', ['a² + b²', 'a² + 2ab + b²', 'a² − 2ab + b²', '2a + 2b'], 1),
  mcq(2, 'Slope of y = 4x − 3?', ['−3', '3', '4', '1/4'], 2),
  tf(2, '√144 = 14', false),
  short(2, 'Sum of the angles of a triangle (degrees)?', '180|180°'),
  mcq(2, '2³ × 2² = ?', ['2⁵', '2⁶', '4⁵', '2¹'], 0),
  tf(2, 'x² = 49 has two solutions.', true),
  mcq(3, 'Roots of x² − 5x + 6 = 0?', ['1 and 6', '2 and 3', '−2 and −3', '−1 and 6'], 1),
  short(3, 'log₂ 32 = ?', '5'),
  mcq(3, 'sin 30° = ?', ['1', '√3/2', '1/2', '√2/2'], 2),
  tf(3, 'The derivative of x³ is 3x².', true),
  short(3, 'Arithmetic progression 3, 7, 11, … the 10th term = ?', '39'),
  mcq(3, 'Probability of two heads in two coin tosses?', ['1/2', '1/3', '1/4', '3/4'], 2),
];

export function bankFor(subject: string): PlacementQuestion[] | null {
  if (/ingliz|english|ielts|cefr|toefl|sat verbal/i.test(subject)) return ENGLISH_BANK;
  if (/matem|math|algebra|geomet|sat math/i.test(subject)) return MATH_BANK;
  return null;
}

// Picks `count` questions spread over the three levels (leaning to the
// target level when given), mixing question types within each level.
export function pickFromBank(bank: PlacementQuestion[], count: number, targetLevel?: 1 | 2 | 3): PlacementQuestion[] {
  const weights = [1, 2, 3].map((l) => (targetLevel && l === targetLevel ? 2 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  const out: PlacementQuestion[] = [];
  [1, 2, 3].forEach((level, i) => {
    const qs = bank.filter((q) => q.level === level);
    // Round-robin over types so one level isn't all multiple choice.
    const byType = (['MCQ', 'TRUE_FALSE', 'SHORT_ANSWER'] as const).map((t) => qs.filter((q) => q.type === t));
    const mixed: PlacementQuestion[] = [];
    for (let k = 0; mixed.length < qs.length; k++) for (const list of byType) if (list[k]) mixed.push(list[k]);
    out.push(...mixed.slice(0, Math.round((count * weights[i]) / total)));
  });
  for (const q of bank) {
    if (out.length >= count) break;
    if (!out.includes(q)) out.push(q);
  }
  return out.slice(0, count).sort((a, b) => a.level - b.level);
}

// Grades one answer. For MCQ/TRUE_FALSE the answer is the option index.
export function isCorrect(q: PlacementQuestion, given: string | undefined | null): boolean {
  const a = (given ?? '').trim();
  if (!a) return false;
  if (q.type === 'SHORT_ANSWER') {
    const norm = (s: string) => s.trim().toLowerCase().replace(/[.,!?;:"'`]+$/g, '').replace(/\s+/g, ' ');
    return (q.answer ?? '').split('|').map(norm).filter(Boolean).includes(norm(a));
  }
  return a === String(q.correctIndex);
}

// Suggested level from per-level results: advanced needs most level-3
// questions right on top of level 2, and so on.
export function suggestLevel(questions: PlacementQuestion[], answers: Array<string | null | undefined>): 1 | 2 | 3 {
  const pct = (level: number) => {
    const idx = questions.map((q, i) => (q.level === level ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return null;
    return (idx.filter((i) => isCorrect(questions[i], answers[i])).length / idx.length) * 100;
  };
  const ok = (p: number | null, min: number) => p === null || p >= min;
  const [l1, l2, l3] = [pct(1), pct(2), pct(3)];
  if (l3 !== null && l3 >= 60 && ok(l2, 70)) return 3;
  if (l2 !== null && l2 >= 60 && ok(l1, 70)) return 2;
  return 1;
}
