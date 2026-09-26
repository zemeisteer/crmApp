// Built-in placement questions, used when no AI key is configured (and as
// a fallback if the AI answer can't be parsed). Level 1 = beginner,
// 2 = intermediate, 3 = advanced.

export interface PlacementQuestion {
  prompt: string;
  options: string[];
  correctIndex: number;
  level: 1 | 2 | 3;
}

export const ENGLISH_BANK: PlacementQuestion[] = [
  { level: 1, prompt: 'She ___ a teacher.', options: ['am', 'is', 'are', 'be'], correctIndex: 1 },
  { level: 1, prompt: 'I ___ coffee every morning.', options: ['drinks', 'drinking', 'drink', 'am drink'], correctIndex: 2 },
  { level: 1, prompt: 'There ___ two books on the table.', options: ['is', 'are', 'be', 'has'], correctIndex: 1 },
  { level: 1, prompt: 'What is the plural of "child"?', options: ['childs', 'childes', 'children', 'childrens'], correctIndex: 2 },
  { level: 1, prompt: '___ you like pizza?', options: ['Does', 'Do', 'Are', 'Is'], correctIndex: 1 },
  { level: 1, prompt: 'We went to the park ___ Sunday.', options: ['in', 'at', 'on', 'by'], correctIndex: 2 },
  { level: 1, prompt: 'He can ___ very fast.', options: ['runs', 'running', 'to run', 'run'], correctIndex: 3 },
  { level: 2, prompt: 'I have lived here ___ 2019.', options: ['for', 'since', 'from', 'during'], correctIndex: 1 },
  { level: 2, prompt: 'If it rains tomorrow, we ___ at home.', options: ['stay', 'will stay', 'would stay', 'stayed'], correctIndex: 1 },
  { level: 2, prompt: 'She asked me where I ___.', options: ['live', 'am living', 'lived', 'do live'], correctIndex: 2 },
  { level: 2, prompt: 'This is the ___ film I have ever seen.', options: ['good', 'better', 'best', 'most good'], correctIndex: 2 },
  { level: 2, prompt: 'The letter ___ yesterday.', options: ['was sent', 'sent', 'has sent', 'is sending'], correctIndex: 0 },
  { level: 2, prompt: 'I am not used to ___ up so early.', options: ['get', 'getting', 'got', 'be got'], correctIndex: 1 },
  { level: 2, prompt: 'Choose the synonym of "reluctant".', options: ['eager', 'unwilling', 'careful', 'lucky'], correctIndex: 1 },
  { level: 3, prompt: 'Had I known about the traffic, I ___ earlier.', options: ['would leave', 'left', 'would have left', 'had left'], correctIndex: 2 },
  { level: 3, prompt: 'Not only ___ late, but he also forgot the tickets.', options: ['he was', 'was he', 'he is', 'did he'], correctIndex: 1 },
  { level: 3, prompt: 'The proposal was rejected, ___ surprised no one.', options: ['that', 'what', 'which', 'it'], correctIndex: 2 },
  { level: 3, prompt: '"To beat around the bush" means…', options: ['to garden', 'to avoid the main topic', 'to win easily', 'to hide'], correctIndex: 1 },
  { level: 3, prompt: 'She insisted that he ___ present at the meeting.', options: ['is', 'was', 'be', 'will be'], correctIndex: 2 },
  { level: 3, prompt: 'Choose the correct word: The results were ___ with our predictions.', options: ['consistent', 'consisting', 'consist', 'consistently'], correctIndex: 0 },
];

export const MATH_BANK: PlacementQuestion[] = [
  { level: 1, prompt: '7 × 8 = ?', options: ['54', '56', '58', '64'], correctIndex: 1 },
  { level: 1, prompt: '125 + 378 = ?', options: ['493', '503', '513', '403'], correctIndex: 1 },
  { level: 1, prompt: '1/2 + 1/4 = ?', options: ['2/6', '3/4', '1/6', '2/4'], correctIndex: 1 },
  { level: 1, prompt: '20% of 150 = ?', options: ['20', '25', '30', '35'], correctIndex: 2 },
  { level: 1, prompt: 'Perimeter of a square with side 6?', options: ['12', '24', '36', '18'], correctIndex: 1 },
  { level: 1, prompt: '81 : 9 = ?', options: ['7', '8', '9', '11'], correctIndex: 2 },
  { level: 1, prompt: '0.5 × 0.4 = ?', options: ['2', '0.2', '0.02', '0.9'], correctIndex: 1 },
  { level: 2, prompt: 'Solve: 3x − 7 = 11', options: ['x = 4', 'x = 5', 'x = 6', 'x = 18'], correctIndex: 2 },
  { level: 2, prompt: '(a + b)² = ?', options: ['a² + b²', 'a² + 2ab + b²', 'a² − 2ab + b²', '2a + 2b'], correctIndex: 1 },
  { level: 2, prompt: 'Slope of y = 4x − 3?', options: ['−3', '3', '4', '1/4'], correctIndex: 2 },
  { level: 2, prompt: '√144 = ?', options: ['11', '12', '14', '72'], correctIndex: 1 },
  { level: 2, prompt: 'Sum of the angles of a triangle?', options: ['90°', '180°', '270°', '360°'], correctIndex: 1 },
  { level: 2, prompt: '2³ × 2² = ?', options: ['2⁵', '2⁶', '4⁵', '2¹'], correctIndex: 0 },
  { level: 2, prompt: 'Solve: x² = 49', options: ['x = 7', 'x = ±7', 'x = 49', 'x = −7'], correctIndex: 1 },
  { level: 3, prompt: 'Roots of x² − 5x + 6 = 0?', options: ['1 and 6', '2 and 3', '−2 and −3', '−1 and 6'], correctIndex: 1 },
  { level: 3, prompt: 'log₂ 32 = ?', options: ['4', '5', '6', '16'], correctIndex: 1 },
  { level: 3, prompt: 'sin 30° = ?', options: ['1', '√3/2', '1/2', '√2/2'], correctIndex: 2 },
  { level: 3, prompt: 'Derivative of x³?', options: ['x²', '3x²', '3x', 'x⁴/4'], correctIndex: 1 },
  { level: 3, prompt: 'Arithmetic progression 3, 7, 11, … the 10th term?', options: ['39', '40', '43', '37'], correctIndex: 0 },
  { level: 3, prompt: 'Probability of two heads in two coin tosses?', options: ['1/2', '1/3', '1/4', '3/4'], correctIndex: 2 },
];

export function bankFor(subject: string): PlacementQuestion[] | null {
  if (/ingliz|english|ielts|cefr|toefl|sat verbal/i.test(subject)) return ENGLISH_BANK;
  if (/matem|math|algebra|geomet|sat math/i.test(subject)) return MATH_BANK;
  return null;
}

// Picks `count` questions spread evenly over the three levels, or leaning
// to the target level when one is given.
export function pickFromBank(bank: PlacementQuestion[], count: number, targetLevel?: 1 | 2 | 3): PlacementQuestion[] {
  const byLevel = [1, 2, 3].map((l) => bank.filter((q) => q.level === l));
  const weights = targetLevel ? [1, 2, 3].map((l) => (l === targetLevel ? 2 : 1)) : [1, 1, 1];
  const total = weights.reduce((s, w) => s + w, 0);
  const out: PlacementQuestion[] = [];
  byLevel.forEach((qs, i) => {
    const n = Math.min(qs.length, Math.round((count * weights[i]) / total));
    out.push(...qs.slice(0, n));
  });
  // Top up from any level if rounding left us short.
  for (const q of bank) {
    if (out.length >= count) break;
    if (!out.includes(q)) out.push(q);
  }
  return out.slice(0, count).sort((a, b) => a.level - b.level);
}
