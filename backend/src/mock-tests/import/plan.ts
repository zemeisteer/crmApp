import { isLevel, type Level, type MockModule } from '../ielts';

// Where each test sits in an uploaded book (1-based page numbers) and which
// recordings belong to it. Pure functions: the AI proposes, these clean up.

export interface TestPlan {
  title: string;
  level: Level | null;
  listening: number[];
  reading: number[];
  writing: number[];
  speaking: number[];
  answerKey: number[];
  audioscript: number[];
}

export interface BookPlan {
  book: string | null;
  module: MockModule;
  tests: TestPlan[];
}

const KINDS = ['listening', 'reading', 'writing', 'speaking', 'answerKey', 'audioscript'] as const;
type Kind = (typeof KINDS)[number];

// "3-7", 3, [3, 4], "3, 5-6" -> [3, 4, 5, 6, 7] within the book.
export function pagesOf(v: unknown, total: number): number[] {
  const out = new Set<number>();
  const add = (a: number, b = a) => {
    for (let p = Math.max(1, Math.min(a, b)); p <= Math.min(total, Math.max(a, b)) && out.size < 400; p++) out.add(p);
  };
  const walk = (x: unknown) => {
    if (typeof x === 'number' && Number.isInteger(x)) add(x);
    else if (typeof x === 'string') {
      for (const part of x.split(/[,;]/)) {
        const m = part.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
        if (m) add(Number(m[1]), Number(m[2]));
        else if (/^\d+$/.test(part.trim())) add(Number(part.trim()));
      }
    } else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object' && 'from' in x) add(Number((x as { from: number }).from), Number((x as { to?: number }).to ?? (x as { from: number }).from));
  };
  walk(v);
  return [...out].sort((a, b) => a - b);
}

// The AI's map of the book -> tests that have at least one usable section.
export function normalizePlan(raw: unknown, total: number): BookPlan {
  const r = (raw ?? {}) as Record<string, any>;
  const tests = (Array.isArray(r.tests) ? r.tests : []).slice(0, 12).map((t: any, i: number): TestPlan => ({
    title: typeof t?.title === 'string' && t.title.trim() ? t.title.trim().slice(0, 120) : `Test ${i + 1}`,
    level: isLevel(t?.estimatedLevel) ? t.estimatedLevel : null,
    listening: pagesOf(t?.listening, total),
    reading: pagesOf(t?.reading, total),
    writing: pagesOf(t?.writing, total),
    speaking: pagesOf(t?.speaking, total),
    answerKey: pagesOf(t?.answerKey, total),
    audioscript: pagesOf(t?.audioscript, total),
  })).filter((t) => t.listening.length + t.reading.length + t.writing.length + t.speaking.length > 0);
  return {
    book: typeof r.book === 'string' && r.book.trim() ? r.book.trim().slice(0, 160) : null,
    module: r.module === 'GENERAL' ? 'GENERAL' : 'ACADEMIC',
    tests,
  };
}

// Scanned books: the AI labels pages chunk by chunk; pages of the same test
// number are grouped. A page without a test number joins the test before it.
export function planFromLabels(labels: Array<{ page: number; test: number | null; kind: string }>, meta: { book?: string | null; module?: MockModule } = {}): BookPlan {
  const byTest = new Map<number, TestPlan>();
  let last: number | null = null;
  for (const l of [...labels].sort((a, b) => a.page - b.page)) {
    const kind = KINDS.find((k) => k.toLowerCase() === String(l.kind).toLowerCase()) as Kind | undefined;
    const testNo: number | null = Number.isInteger(l.test) && (l.test as number) > 0 ? (l.test as number) : last;
    if (!kind || testNo == null) continue;
    last = testNo;
    if (!byTest.has(testNo)) byTest.set(testNo, { title: `Test ${testNo}`, level: null, listening: [], reading: [], writing: [], speaking: [], answerKey: [], audioscript: [] });
    byTest.get(testNo)![kind].push(l.page);
  }
  return {
    book: meta.book ?? null,
    module: meta.module ?? 'ACADEMIC',
    tests: [...byTest.entries()].sort(([a], [b]) => a - b).map(([, t]) => t)
      .filter((t) => t.listening.length + t.reading.length + t.writing.length + t.speaking.length > 0),
  };
}

// --------------------------------------------------------------- audio

export interface AudioAssignment {
  // One recording for a test's whole Listening section...
  section: string | null;
  // ...or one per part (index 0 = Part 1).
  parts: Array<string | null>;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// Reads "Test 2 Part 3", "C18_T2_S3", "test2-section1", "18-2-3" (book-test-
// part) from a file name.
export function parseAudioName(name: string): { test: number | null; part: number | null; numbers: number[] } {
  const base = name.toLowerCase().replace(/\.[a-z0-9]+$/, '');
  const test = base.match(/(?:^|[^a-z])(?:test|t)\s*[-_ ]?(\d{1,2})(?!\d)/)?.[1];
  const part = base.match(/(?:^|[^a-z])(?:part|section|sec|p|s)\s*[-_ ]?(\d)(?!\d)/)?.[1];
  const numbers = (base.match(/\d+/g) ?? []).map(Number);
  return { test: test ? Number(test) : null, part: part ? Number(part) : null, numbers };
}

// Assigns uploaded recordings to the tests (in book order) and their parts.
// Named files first; the rest by count: tests x 4 files -> part by part,
// one file per test -> whole section. Anything left over is reported.
export function matchAudio(files: string[], tests: number, partsPerTest: number[] = []): { assignments: AudioAssignment[]; unmatched: string[] } {
  const assignments: AudioAssignment[] = Array.from({ length: tests }, (_, i) => ({ section: null, parts: Array(Math.max(4, partsPerTest[i] ?? 4)).fill(null) }));
  const left: string[] = [];
  for (const f of [...files].sort(natural)) {
    const { test, part, numbers } = parseAudioName(f);
    let p = part;
    // With one test a part number is enough; a bare name waits for the count rules.
    let t = test ?? (tests === 1 && p != null ? 1 : null);
    // "18-2-3": book, test, part.
    if (t == null && p == null && numbers.length === 3 && numbers[1] <= tests && numbers[2] >= 1 && numbers[2] <= 4) {
      t = numbers[1];
      p = numbers[2];
    }
    if (t != null && t >= 1 && t <= tests) {
      const a = assignments[t - 1];
      if (p != null && p >= 1 && p <= a.parts.length && !a.parts[p - 1]) { a.parts[p - 1] = f; continue; }
      if (p == null && !a.section) { a.section = f; continue; }
    }
    left.push(f);
  }
  const free = assignments.every((a) => !a.section && a.parts.every((x) => !x));
  if (free && left.length > 0) {
    if (left.length === tests * 4) {
      left.forEach((f, i) => { assignments[Math.floor(i / 4)].parts[i % 4] = f; });
      return { assignments, unmatched: [] };
    }
    if (left.length === tests) {
      left.forEach((f, i) => { assignments[i].section = f; });
      return { assignments, unmatched: [] };
    }
  }
  return { assignments, unmatched: left };
}
